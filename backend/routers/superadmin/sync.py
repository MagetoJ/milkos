"""Platform view of offline operations: sync health, devices, sensors, cooler readings and notifications.

These read the same rows the cooperatives' devices synchronised; nothing is copied for the superadmin.
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, fetch_page, page_params, page_result
from core.utils import iso, parse_uuid
from db import get_db
from models.admin import Cooler
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from models.sensors import CoolerReading, SensorDevice
from models.sync import Device, DeviceSession, MutationStatus, SyncMutation
from schemas.sync import DeviceUpdate
from services import cooler_readings, notifications, sensors
from services.sync import devices

router = APIRouter()


def _coop_filter(query, column, cooperative_id: Optional[str]):
    return query.filter(column == parse_uuid(cooperative_id, "Cooperative")) if cooperative_id else query


@router.get("/sync/health")
def sync_health(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
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


@router.get("/sync/devices")
def list_devices(
    cooperative_id: Optional[str] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = db.query(Device, Cooperative.name).outerjoin(Cooperative, Cooperative.id == Device.cooperative_id)
    query = _coop_filter(query, Device.cooperative_id, cooperative_id)
    query = query.order_by(Device.last_seen_at.desc().nullslast(), Device.id)
    rows, total = fetch_page(query, params)
    return page_result([devices.device_json(d, name) for d, name in rows], total, params)


@router.patch("/sync/devices/{device_id}")
def update_device(
    device_id: str, payload: DeviceUpdate, release: bool = Query(False, description="Unbind from its cooperative"),
    db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin),
):
    device = db.get(Device, parse_uuid(device_id, "Device"))
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if release:
        device = devices.release(db, admin, device)
    if payload.is_active is not None or payload.label is not None:
        device = devices.set_active(
            db, admin, device, device.is_active if payload.is_active is None else payload.is_active, payload.label
        )
    coop = db.get(Cooperative, device.cooperative_id) if device.cooperative_id else None
    return devices.device_json(device, coop.name if coop else None)


@router.get("/sensors")
def list_sensors(
    cooperative_id: Optional[str] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
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


@router.get("/cooler-readings")
def list_readings(
    cooperative_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    quality: Optional[str] = Query(None, pattern="^(VALID|SUSPICIOUS|SIMULATED)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = (
        db.query(CoolerReading, Cooler.name, Cooler.code, Cooperative.name)
        .join(Cooler, Cooler.id == CoolerReading.cooler_id)
        .join(Cooperative, Cooperative.id == CoolerReading.cooperative_id)
    )
    query = _coop_filter(query, CoolerReading.cooperative_id, cooperative_id)
    if cooler_id:
        query = query.filter(CoolerReading.cooler_id == parse_uuid(cooler_id, "Cooler"))
    if quality:
        query = query.filter(CoolerReading.quality == quality)
    query = query.order_by(CoolerReading.measured_at.desc(), CoolerReading.id)
    rows, total = fetch_page(query, params)
    return page_result(
        [{**cooler_readings.reading_json(r), "cooler_name": name, "cooler_code": code, "cooperative_name": coop}
         for r, name, code, coop in rows],
        total, params,
    )


@router.get("/notifications")
def list_notifications(
    cooperative_id: Optional[str] = None,
    notification_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|SENT|FAILED|SKIPPED)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = db.query(Notification, Cooperative.name).join(Cooperative, Cooperative.id == Notification.cooperative_id)
    query = _coop_filter(query, Notification.cooperative_id, cooperative_id)
    if notification_status:
        query = query.filter(Notification.status == notification_status)
    query = query.order_by(Notification.created_at.desc(), Notification.id)
    rows, total = fetch_page(query, params)
    return page_result(
        [{**notifications.notification_json(n), "cooperative_name": name} for n, name in rows], total, params,
    )
