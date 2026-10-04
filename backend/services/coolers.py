"""Coolers (bulk milk tanks / collection devices)."""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import changed, conflict, field_error, iso, next_sequence, num, reject_nulls, snapshot
from models.admin import Cooler, CoolerStatus
from models.cooperative import Cooperative
from models.operations import MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CoolerCreate, CoolerUpdate
from services import audit
from services.common import check_centre, target_cooperative

AUDITED = (
    "code", "name", "centre_id", "location", "capacity_litres", "scale_device_id", "status", "is_operational",
    "manager_user_id", "low_volume_alert_litres", "high_volume_alert_litres", "min_temperature_c",
    "max_temperature_c", "stale_after_minutes", "low_battery_percent", "alerts_enabled",
)
ALERT_FIELDS = (
    "manager_user_id", "low_volume_alert_litres", "high_volume_alert_litres", "min_temperature_c",
    "max_temperature_c", "stale_after_minutes", "low_battery_percent", "alerts_enabled",
)


def cooler_json(
    cooler: Cooler, *, cooperative: Optional[Cooperative] = None, centre_name: Optional[str] = None,
    litres_today: float = 0.0, manager_name: Optional[str] = None, sensors: Optional[list[dict]] = None,
) -> dict:
    data = {
        "id": str(cooler.id),
        "cooperative_id": str(cooler.cooperative_id),
        "code": cooler.code,
        "name": cooler.name,
        "location": cooler.location,
        "centre_id": str(cooler.centre_id) if cooler.centre_id else None,
        "centre_name": centre_name,
        "capacity_litres": num(cooler.capacity_litres),
        "scale_device_id": cooler.scale_device_id,
        "status": cooler.status,
        "is_operational": bool(cooler.is_operational),
        "last_temperature_c": num(cooler.last_temperature_c),
        "last_reading_at": iso(cooler.last_reading_at),
        "litres_today": litres_today,
        "manager_user_id": str(cooler.manager_user_id) if cooler.manager_user_id else None,
        "manager_name": manager_name,
        "current_volume_litres": num(cooler.current_volume_litres),
        "last_seen_at": iso(cooler.last_seen_at),
        "low_volume_alert_litres": num(cooler.low_volume_alert_litres),
        "high_volume_alert_litres": num(cooler.high_volume_alert_litres),
        "min_temperature_c": num(cooler.min_temperature_c),
        "max_temperature_c": num(cooler.max_temperature_c),
        "stale_after_minutes": cooler.stale_after_minutes,
        "low_battery_percent": cooler.low_battery_percent,
        "alerts_enabled": bool(cooler.alerts_enabled),
        "sensors": sensors or [],
        "sync_version": cooler.sync_version,
        "created_at": iso(cooler.created_at),
        "updated_at": iso(cooler.updated_at),
    }
    if cooperative is not None:
        data["cooperative_name"] = cooperative.name
        data["cooperative_code"] = cooperative.code
    return data


def litres_today(db: Session, cooler_ids: list[UUID]) -> dict[UUID, float]:
    if not cooler_ids:
        return {}
    today = datetime.datetime.utcnow().date()
    rows = (
        db.query(MilkCollection.cooler_id, func.coalesce(func.sum(MilkCollection.quantity_litres), 0))
        .filter(
            MilkCollection.cooler_id.in_(cooler_ids), MilkCollection.collection_date == today,
            MilkCollection.quality_status == QualityStatus.ACCEPTED,
        )
        .group_by(MilkCollection.cooler_id)
        .all()
    )
    return {cid: num(total) or 0.0 for cid, total in rows}


def _code_taken(db: Session, cooperative_id: UUID, code: str, exclude_id: Optional[UUID] = None) -> bool:
    query = db.query(Cooler.id).filter(Cooler.cooperative_id == cooperative_id, Cooler.code == code)
    if exclude_id:
        query = query.filter(Cooler.id != exclude_id)
    return query.first() is not None


def check_manager(db: Session, cooperative_id: UUID, manager_user_id: Optional[UUID]) -> None:
    """The person in charge must be an active admin or manager of the same cooperative."""
    if manager_user_id is None:
        return
    user = db.get(User, manager_user_id)
    if (
        user is None or user.cooperative_id != cooperative_id or not user.is_active
        or user.role_value not in (UserRole.COOP_ADMIN.value, UserRole.MANAGER.value)
    ):
        raise field_error("manager_user_id", "Choose an active admin or manager from this cooperative.")


def _alert_values(data: dict) -> dict:
    values = {k: data[k] for k in ALERT_FIELDS if k in data}
    if values.get("alerts_enabled", True) is None:
        values.pop("alerts_enabled")
    return values


def create(db: Session, principal: Principal, payload: CoolerCreate) -> Cooler:
    cooperative = target_cooperative(db, principal, payload.cooperative_id)
    check_centre(db, cooperative.id, payload.centre_id)
    check_manager(db, cooperative.id, payload.manager_user_id)
    explicit = payload.code is not None
    for attempt in range(3):
        code = payload.code or next_sequence(
            (row[0] for row in db.query(Cooler.code).filter(Cooler.cooperative_id == cooperative.id)), "CLR", 3
        )
        if _code_taken(db, cooperative.id, code):
            raise conflict("code", "Another cooler in this cooperative already uses this code.")
        cooler = Cooler(
            cooperative_id=cooperative.id, centre_id=payload.centre_id, code=code, name=payload.name,
            location=payload.location, capacity_litres=payload.capacity_litres,
            scale_device_id=payload.scale_device_id, is_operational=payload.is_operational,
            status=CoolerStatus.ACTIVE, **_alert_values(payload.model_dump(exclude_unset=True)),
        )
        db.add(cooler)
        try:
            db.flush()
            audit.record(
                db, principal, "COOLER_CREATED", target=f"{cooler.name} ({cooler.code}) in {cooperative.name}",
                entity_type="cooler", entity_id=cooler.id, cooperative_id=cooperative.id,
                new_values=snapshot(cooler, AUDITED),
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            if explicit or attempt == 2:
                raise conflict("code", "Another cooler in this cooperative already uses this code.")
            continue
        db.refresh(cooler)
        return cooler
    raise conflict("code", "Could not allocate a cooler code. Try again.")  # pragma: no cover


def update(db: Session, principal: Principal, cooler: Cooler, payload: CoolerUpdate) -> Cooler:
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "name", "code", "status", "is_operational", "alerts_enabled")
    if "manager_user_id" in data:
        check_manager(db, cooler.cooperative_id, data["manager_user_id"])
    if "centre_id" in data:
        check_centre(db, cooler.cooperative_id, data["centre_id"])
    if data.get("code") and _code_taken(db, cooler.cooperative_id, data["code"], cooler.id):
        raise conflict("code", "Another cooler in this cooperative already uses this code.")

    before = snapshot(cooler, AUDITED)
    for name, value in data.items():
        if name == "last_temperature_c":
            continue
        setattr(cooler, name, value)
    if data.get("last_temperature_c") is not None:
        cooler.last_temperature_c = data["last_temperature_c"]
        cooler.last_reading_at = datetime.datetime.utcnow()
    if cooler.status == CoolerStatus.INACTIVE:
        cooler.is_operational = False  # a decommissioned cooler is never "online"

    old, new = changed(before, snapshot(cooler, AUDITED))
    if new:
        if set(new) <= {"status", "is_operational"} and "status" in new:
            action = "COOLER_ACTIVATED" if cooler.status == CoolerStatus.ACTIVE else "COOLER_DEACTIVATED"
        elif set(new) == {"is_operational"}:
            action = "COOLER_ONLINE" if cooler.is_operational else "COOLER_OFFLINE"
        else:
            action = "COOLER_UPDATED"
        audit.record(
            db, principal, action, target=f"{cooler.name} ({cooler.code})",
            entity_type="cooler", entity_id=cooler.id, cooperative_id=cooler.cooperative_id,
            old_values=old, new_values=new,
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("code", "Another cooler in this cooperative already uses this code.")
    db.refresh(cooler)
    return cooler
