"""What each synchronised entity looks like on a device, and who may receive it.

Every serializer takes the ids of one entity type and returns {id: data}, or {id: MISSING} for rows that
don't exist or that this caller may not see (the device deletes its copy), or {id: SKIP} for rows outside
the sync window (left alone; old history isn't kept on devices). Rows of another cooperative are MISSING
even if the change log were to name them: the cooperative check is repeated here on purpose.

The shapes are the same ones the online endpoints return, so screens render either source unchanged.
"""
import datetime
import os
from typing import Callable
from uuid import UUID

from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import iso, num
from core.validation import mask_phone_local
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.notifications import Notification
from models.operations import CollectionBatch, Collector, MilkCollection
from models.sensors import CoolerReading, SensorDevice
from models.user import User
from schemas.auth import UserRole
from services import batches, centres, collections, collectors, cooler_readings, coolers, farmers, notifications, sensors

MISSING = object()
SKIP = object()

STAFF = {UserRole.COOP_ADMIN.value, UserRole.MANAGER.value}
TEAM_ROLES = (UserRole.COOP_ADMIN, UserRole.MANAGER, UserRole.COLLECTOR)

# Entity types each role receives. Platform staff get only the cooperative directory: their console stays
# online-first and the whole platform is never copied onto one device.
ROLE_TYPES: dict[str, frozenset[str]] = {
    UserRole.COOP_ADMIN.value: frozenset({
        "cooperative", "farmer", "centre", "cooler", "collector", "team_member", "collection",
        "collection_batch", "cooler_reading", "sensor", "notification",
    }),
    UserRole.MANAGER.value: frozenset({
        "cooperative", "farmer", "centre", "cooler", "collector", "team_member", "collection",
        "collection_batch", "cooler_reading", "sensor", "notification",
    }),
    UserRole.COLLECTOR.value: frozenset({
        "cooperative", "farmer", "centre", "cooler", "collector", "collection", "collection_batch",
        "cooler_reading", "sensor",
    }),
    UserRole.SUPER_ADMIN.value: frozenset({"cooperative"}),
}


def window() -> dict:
    return {
        "collection_days": int(os.getenv("SYNC_COLLECTION_DAYS", "30")),
        "reading_days": int(os.getenv("SYNC_READING_DAYS", "7")),
        "notification_days": int(os.getenv("SYNC_NOTIFICATION_DAYS", "30")),
    }


def _uuids(ids: list[str]) -> list[UUID]:
    out = []
    for value in ids:
        try:
            out.append(UUID(value))
        except ValueError:
            pass
    return out


def _mine(principal: Principal, row) -> bool:
    return principal.is_superadmin or getattr(row, "cooperative_id", None) == principal.cooperative_id


def _result(ids: list[str], found: dict) -> dict:
    return {i: found.get(i, MISSING) for i in ids}


def cooperative(db: Session, principal: Principal, ids: list[str]) -> dict:
    found = {}
    for coop in db.query(Cooperative).filter(Cooperative.id.in_(_uuids(ids))):
        if principal.is_superadmin or coop.id == principal.cooperative_id:
            found[str(coop.id)] = {
                "id": str(coop.id), "name": coop.name, "code": coop.code, "county": coop.county,
                "location": coop.location, "status": coop.status, "sms_credit_balance": coop.sms_credit_balance or 0,
                "receipt_sms_enabled": bool(coop.receipt_sms_enabled),
                "estimated_daily_liters": num(coop.estimated_daily_liters),
                "alert_sms_enabled": bool(coop.alert_sms_enabled), "created_at": iso(coop.created_at),
            }
    return _result(ids, found)


def farmer(db: Session, principal: Principal, ids: list[str]) -> dict:
    rows = (
        db.query(Farmer, CollectionCentre.name)
        .outerjoin(CollectionCentre, CollectionCentre.id == Farmer.centre_id)
        .filter(Farmer.id.in_(_uuids(ids)))
        .all()
    )
    found = {}
    for f, centre_name in rows:
        if not _mine(principal, f):
            continue
        data = farmers.farmer_json(f, centre_name)
        if principal.role not in STAFF:
            # Collectors only need to pick a farmer: no ID numbers, payout details or full phone numbers on their
            # devices. The masked number (0712••••78) is enough to tell two Janes apart.
            data = {k: data[k] for k in (
                "id", "cooperative_id", "farmer_number", "first_name", "last_name", "full_name",
                "village", "status", "centre_id", "centre_name", "sync_version", "updated_at",
            )}
            data["phone_masked"] = mask_phone_local(f.phone)
        found[str(f.id)] = data
    return _result(ids, found)


def centre(db: Session, principal: Principal, ids: list[str]) -> dict:
    rows = [c for c in db.query(CollectionCentre).filter(CollectionCentre.id.in_(_uuids(ids))) if _mine(principal, c)]
    found = {}
    for data in centres.serialize(db, rows):
        if principal.role not in STAFF:
            data = {k: data[k] for k in ("id", "name", "code", "county", "status", "has_cooler", "sync_version")}
        found[data["id"]] = data
    return _result(ids, found)


def cooler(db: Session, principal: Principal, ids: list[str]) -> dict:
    rows = (
        db.query(Cooler, CollectionCentre.name)
        .outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id)
        .filter(Cooler.id.in_(_uuids(ids)))
        .all()
    )
    rows = [(c, name) for c, name in rows if _mine(principal, c)]
    cooler_ids = [c.id for c, _ in rows]
    today = coolers.litres_today(db, cooler_ids)
    managers = centres.manager_names(db, {c.manager_user_id for c, _ in rows})
    bound = sensors.for_coolers(db, cooler_ids)
    context = coolers.context_for(db, [c for c, _ in rows], bound)
    found = {
        str(c.id): coolers.cooler_json(
            c, centre_name=name, litres_today=today.get(c.id, 0.0), manager_name=managers.get(c.manager_user_id),
            sensors=bound.get(c.id), context=context.get(c.id),
        )
        for c, name in rows
    }
    return _result(ids, found)


def collector(db: Session, principal: Principal, ids: list[str]) -> dict:
    rows = (
        db.query(Collector, User, CollectionCentre.name, Cooler.name)
        .join(User, User.id == Collector.user_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Collector.centre_id)
        .outerjoin(Cooler, Cooler.id == Collector.cooler_id)
        .filter(Collector.id.in_(_uuids(ids)))
        .all()
    )
    if principal.role == UserRole.COLLECTOR.value:
        rows = [r for r in rows if r[0].user_id == principal.user.id]
    rows = [r for r in rows if _mine(principal, r[0])]
    stats = collectors.stats_for(db, [r[0].id for r in rows])
    found = {
        str(c.id): {**collectors.collector_json(c, u, centre_name=cn, cooler_name=kn, stats=stats.get(c.id)),
                    "sync_version": c.sync_version}
        for c, u, cn, kn in rows
    }
    return _result(ids, found)


def team_member(db: Session, principal: Principal, ids: list[str]) -> dict:
    found = {}
    for user in db.query(User).filter(User.id.in_(_uuids(ids))):
        if user.cooperative_id != principal.cooperative_id or user.role not in TEAM_ROLES:
            continue
        found[str(user.id)] = {
            "id": str(user.id), "full_name": user.full_name, "email": user.email, "phone_number": user.phone_number,
            "role": user.role_value, "is_active": bool(user.is_active), "is_you": user.id == principal.user.id,
            "created_at": iso(user.created_at),
        }
    return _result(ids, found)


def collection(db: Session, principal: Principal, ids: list[str]) -> dict:
    since = datetime.datetime.utcnow().date() - datetime.timedelta(days=window()["collection_days"])
    rows = collections.base_query(db).filter(MilkCollection.id.in_(_uuids(ids))).all()
    own_collector = principal.collector_profile().id if principal.role == UserRole.COLLECTOR.value else None
    found = {}
    for row in rows:
        c = row[0]
        if not _mine(principal, c) or (own_collector is not None and c.collector_id != own_collector):
            continue
        found[str(c.id)] = SKIP if c.collection_date < since else collections.collection_json(row)
    return _result(ids, found)


def collection_batch(db: Session, principal: Principal, ids: list[str]) -> dict:
    since = datetime.datetime.utcnow().date() - datetime.timedelta(days=window()["collection_days"])
    rows = db.query(CollectionBatch).filter(CollectionBatch.id.in_(_uuids(ids))).all()
    own_collector = principal.collector_profile().id if principal.role == UserRole.COLLECTOR.value else None
    visible = [
        b for b in rows
        if _mine(principal, b) and (own_collector is None or b.collector_id == own_collector)
    ]
    recent = [b for b in visible if b.collection_date >= since]
    found: dict = {str(b.id): SKIP for b in visible if b.collection_date < since}
    for data in batches.serialize_many(db, recent):
        found[data["id"]] = data
    return _result(ids, found)


def cooler_reading(db: Session, principal: Principal, ids: list[str]) -> dict:
    since = datetime.datetime.utcnow() - datetime.timedelta(days=window()["reading_days"])
    found = {}
    for r in db.query(CoolerReading).filter(CoolerReading.id.in_(_uuids(ids))):
        if _mine(principal, r):
            found[str(r.id)] = SKIP if r.measured_at < since else cooler_readings.reading_json(r)
    return _result(ids, found)


def sensor(db: Session, principal: Principal, ids: list[str]) -> dict:
    found = {str(s.id): sensors.sensor_json(s) for s in db.query(SensorDevice).filter(SensorDevice.id.in_(_uuids(ids))) if _mine(principal, s)}
    return _result(ids, found)


def notification(db: Session, principal: Principal, ids: list[str]) -> dict:
    since = datetime.datetime.utcnow() - datetime.timedelta(days=window()["notification_days"])
    found = {}
    for n in db.query(Notification).filter(Notification.id.in_(_uuids(ids))):
        if _mine(principal, n):
            found[str(n.id)] = SKIP if (n.created_at or since) < since else notifications.notification_json(n)
    return _result(ids, found)


SERIALIZERS: dict[str, Callable[[Session, Principal, list[str]], dict]] = {
    "cooperative": cooperative, "farmer": farmer, "centre": centre, "cooler": cooler, "collector": collector,
    "team_member": team_member, "collection": collection, "collection_batch": collection_batch,
    "cooler_reading": cooler_reading, "sensor": sensor,
    "notification": notification,
}


def one(db: Session, principal: Principal, entity_type: str, entity_id) -> dict | None:
    value = SERIALIZERS[entity_type](db, principal, [str(entity_id)]).get(str(entity_id))
    return value if isinstance(value, dict) else None
