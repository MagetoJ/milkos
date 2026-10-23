"""Every cooler, sensor, device and reading on the platform, and offline-sync health per cooperative."""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.core.utils import iso, like
from app.infrastructure.db.models.admin import Cooler
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.notifications import Notification, NotificationStatus
from app.infrastructure.db.models.sensors import CoolerReading, SensorDevice
from app.infrastructure.db.models.sync import Device, DeviceSession, MutationStatus, SyncMutation
from app.infrastructure.db.pagination import PageParams, apply_sort, fetch_page, page_result
from app.services import cooler_readings, coolers, notifications, sensors
from app.services.principal import Principal, get_or_404
from app.services.sync import devices

# ---------------- coolers ----------------

COOLER_SORTS = {
    "name": Cooler.name, "code": Cooler.code, "created_at": Cooler.created_at,
    "cooperative": Cooperative.name, "capacity_litres": Cooler.capacity_litres,
}


def _cooler_query(db: Session):
    return (
        db.query(Cooler, Cooperative, CollectionCentre.name)
        .join(Cooperative, Cooperative.id == Cooler.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id)
    )


def _cooler_rows(db: Session, rows) -> list[dict]:
    today = coolers.litres_today(db, [row[0].id for row in rows])
    return [
        coolers.cooler_json(c, cooperative=coop, centre_name=centre, litres_today=today.get(c.id, 0.0))
        for c, coop, centre in rows
    ]


def get_cooler(db: Session, cooler_id: str) -> Cooler:
    return get_or_404(db, Cooler, cooler_id, "Cooler")


def cooler_json(db: Session, cooler: Cooler) -> dict:
    return _cooler_rows(db, [_cooler_query(db).filter(Cooler.id == cooler.id).one()])[0]


def coolers_page(db: Session, *, search: Optional[str], cooperative_id: Optional[UUID], status: Optional[str],
                 operational: Optional[bool], params: PageParams) -> dict:
    query = _cooler_query(db)
    if cooperative_id:
        query = query.filter(Cooler.cooperative_id == cooperative_id)
    if status:
        query = query.filter(Cooler.status == status)
    if operational is not None:
        query = query.filter(Cooler.is_operational.is_(operational))
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            Cooler.name.ilike(pattern, escape="\\"), Cooler.code.ilike(pattern, escape="\\"),
            Cooler.location.ilike(pattern, escape="\\"), Cooler.scale_device_id.ilike(pattern, escape="\\"),
        ))
    query = apply_sort(query, params.sort, COOLER_SORTS, [Cooperative.name, Cooler.code, Cooler.id])
    rows, total = fetch_page(query, params)
    return page_result(_cooler_rows(db, rows), total, params)


# ---------------- offline operations ----------------

def _coop_filter(query, column, cooperative_id: Optional[UUID]):
    return query.filter(column == cooperative_id) if cooperative_id else query


def sync_health(db: Session) -> dict:
    """Per cooperative: devices, last sync, the last 24 hours of offline changes, open conflicts, alerts."""
    now = datetime.datetime.utcnow()
    since = now - datetime.timedelta(hours=24)
    coops = db.query(Cooperative).order_by(Cooperative.name).all()
    device_stats = {
        coop_id: (total, active, last_sync)
        for coop_id, total, active, last_sync in db.query(
            Device.cooperative_id, func.count(Device.id),
            func.sum(case((Device.is_active.is_(True), 1), else_=0)),
            func.max(Device.last_sync_at),
        ).group_by(Device.cooperative_id)
    }
    mutation_stats: dict = {}
    for coop_id, mstatus, count in (
        db.query(SyncMutation.cooperative_id, SyncMutation.status, func.count(SyncMutation.id))
        .filter(SyncMutation.received_at >= since).group_by(SyncMutation.cooperative_id, SyncMutation.status)
    ):
        mutation_stats.setdefault(coop_id, {})[mstatus] = count
    open_conflicts = dict(
        db.query(SyncMutation.cooperative_id, func.count(SyncMutation.id))
        .filter(SyncMutation.status == MutationStatus.CONFLICT, SyncMutation.resolved_at.is_(None))
        .group_by(SyncMutation.cooperative_id)
    )
    failed_sms = dict(
        db.query(Notification.cooperative_id, func.count(Notification.id))
        .filter(Notification.status == NotificationStatus.FAILED).group_by(Notification.cooperative_id)
    )
    readings_24h = dict(
        db.query(CoolerReading.cooperative_id, func.count(CoolerReading.id))
        .filter(CoolerReading.received_at >= since).group_by(CoolerReading.cooperative_id)
    )
    rows = []
    for coop in coops:
        total, active, last_sync = device_stats.get(coop.id, (0, 0, None))
        m = mutation_stats.get(coop.id, {})
        rows.append({
            "cooperative_id": str(coop.id), "cooperative_name": coop.name, "cooperative_code": coop.code,
            "devices": int(total or 0), "active_devices": int(active or 0), "last_sync_at": iso(last_sync),
            "applied_24h": m.get(MutationStatus.APPLIED, 0), "rejected_24h": m.get(MutationStatus.REJECTED, 0),
            "conflicts_24h": m.get(MutationStatus.CONFLICT, 0), "open_conflicts": open_conflicts.get(coop.id, 0),
            "readings_24h": readings_24h.get(coop.id, 0), "failed_notifications": failed_sms.get(coop.id, 0),
        })
    return {
        "generated_at": iso(now),
        "totals": {
            "devices": sum(r["devices"] for r in rows),
            "active_sessions": db.query(func.count(DeviceSession.id))
            .filter(DeviceSession.revoked_at.is_(None), DeviceSession.expires_at >= now).scalar() or 0,
            "applied_24h": sum(r["applied_24h"] for r in rows),
            "open_conflicts": sum(r["open_conflicts"] for r in rows),
            "readings_24h": sum(r["readings_24h"] for r in rows),
            "failed_notifications": sum(r["failed_notifications"] for r in rows),
        },
        "cooperatives": rows,
    }


def devices_page(db: Session, cooperative_id: Optional[UUID], params: PageParams) -> dict:
    query = db.query(Device, Cooperative.name).outerjoin(Cooperative, Cooperative.id == Device.cooperative_id)
    query = _coop_filter(query, Device.cooperative_id, cooperative_id)
    query = query.order_by(Device.last_seen_at.desc().nullslast(), Device.id)
    rows, total = fetch_page(query, params)
    return page_result([devices.device_json(d, name) for d, name in rows], total, params)


def update_device(db: Session, admin: Principal, device_id: str, release: bool, is_active: Optional[bool],
                  label: Optional[str]) -> dict:
    """Release a device from its cooperative and/or rename / (de)activate it."""
    device = get_or_404(db, Device, device_id, "Device")
    if release:
        device = devices.release(db, admin, device)
    if is_active is not None or label is not None:
        device = devices.set_active(db, admin, device, device.is_active if is_active is None else is_active, label)
    coop = db.get(Cooperative, device.cooperative_id) if device.cooperative_id else None
    return devices.device_json(device, coop.name if coop else None)


def sensors_page(db: Session, cooperative_id: Optional[UUID], params: PageParams) -> dict:
    query = (
        db.query(SensorDevice, Cooler.name, Cooperative.name)
        .join(Cooperative, Cooperative.id == SensorDevice.cooperative_id)
        .outerjoin(Cooler, Cooler.id == SensorDevice.cooler_id)
    )
    query = _coop_filter(query, SensorDevice.cooperative_id, cooperative_id).order_by(Cooperative.name, SensorDevice.name)
    rows, total = fetch_page(query, params)
    return page_result(
        [{**sensors.sensor_json(s, cooler_name), "cooperative_name": coop_name} for s, cooler_name, coop_name in rows],
        total, params,
    )


def readings_page(db: Session, cooperative_id: Optional[UUID], cooler_id: Optional[UUID], quality: Optional[str],
                  params: PageParams) -> dict:
    query = (
        db.query(CoolerReading, Cooler.name, Cooler.code, Cooperative.name)
        .join(Cooler, Cooler.id == CoolerReading.cooler_id)
        .join(Cooperative, Cooperative.id == CoolerReading.cooperative_id)
    )
    query = _coop_filter(query, CoolerReading.cooperative_id, cooperative_id)
    if cooler_id:
        query = query.filter(CoolerReading.cooler_id == cooler_id)
    if quality:
        query = query.filter(CoolerReading.quality == quality)
    query = query.order_by(CoolerReading.measured_at.desc(), CoolerReading.id)
    rows, total = fetch_page(query, params)
    return page_result(
        [{**cooler_readings.reading_json(r), "cooler_name": name, "cooler_code": code, "cooperative_name": coop}
         for r, name, code, coop in rows],
        total, params,
    )


def notifications_page(db: Session, cooperative_id: Optional[UUID], status: Optional[str], params: PageParams) -> dict:
    query = db.query(Notification, Cooperative.name).join(Cooperative, Cooperative.id == Notification.cooperative_id)
    query = _coop_filter(query, Notification.cooperative_id, cooperative_id)
    if status:
        query = query.filter(Notification.status == status)
    query = query.order_by(Notification.created_at.desc(), Notification.id)
    rows, total = fetch_page(query, params)
    return page_result(
        [{**notifications.notification_json(n), "cooperative_name": name} for n, name in rows], total, params,
    )
