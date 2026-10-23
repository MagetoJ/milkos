"""Platform view of offline operations: sync health, devices, sensors, cooler readings and notifications.

These read the same rows the cooperatives' devices synchronised; nothing is copied for the superadmin.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.domain.schemas.sync import DeviceUpdate
from app.infrastructure.db.pagination import PageParams
from app.services.platform_admin import equipment
from app.services.principal import Principal

router = APIRouter()


@router.get("/sync/health")
def sync_health(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    """Per cooperative: devices, last sync, the last 24 hours of offline changes, open conflicts, alerts."""
    return equipment.sync_health(db)


@router.get("/sync/devices")
def list_devices(
    cooperative_id: Optional[str] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return equipment.devices_page(db, optional_uuid(cooperative_id, "Cooperative"), params)


@router.patch("/sync/devices/{device_id}")
def update_device(
    device_id: str, payload: DeviceUpdate, release: bool = Query(False, description="Unbind from its cooperative"),
    db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin),
):
    return equipment.update_device(db, admin, device_id, release, payload.is_active, payload.label)


@router.get("/sensors")
def list_sensors(
    cooperative_id: Optional[str] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return equipment.sensors_page(db, optional_uuid(cooperative_id, "Cooperative"), params)


@router.get("/cooler-readings")
def list_readings(
    cooperative_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    quality: Optional[str] = Query(None, pattern="^(VALID|SUSPICIOUS|SIMULATED)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return equipment.readings_page(
        db, optional_uuid(cooperative_id, "Cooperative"), optional_uuid(cooler_id, "Cooler"), quality, params,
    )


@router.get("/notifications")
def list_notifications(
    cooperative_id: Optional[str] = None,
    notification_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|SENT|FAILED|SKIPPED)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return equipment.notifications_page(db, optional_uuid(cooperative_id, "Cooperative"), notification_status, params)
