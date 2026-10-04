"""Cooler sensor registry: registering a sensor, binding it to a cooler, and connection reports."""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import conflict, field_error, iso
from models.admin import Cooler, CoolerStatus
from models.sensors import SensorDevice
from schemas.sync import SensorCreate, SensorEventIn, SensorUpdate
from services import audit, cooler_alerts

IDENTIFIER_TAKEN = "This sensor is already registered in your cooperative."


def sensor_json(sensor: SensorDevice, cooler_name: Optional[str] = None) -> dict:
    return {
        "id": str(sensor.id),
        "cooperative_id": str(sensor.cooperative_id),
        "cooler_id": str(sensor.cooler_id) if sensor.cooler_id else None,
        "cooler_name": cooler_name,
        "sensor_identifier": sensor.sensor_identifier,
        "name": sensor.name,
        "sensor_type": sensor.sensor_type,
        "transport": sensor.transport,
        "protocol": sensor.protocol,
        "bluetooth_device_id": sensor.bluetooth_device_id,
        "bluetooth_name": sensor.bluetooth_name,
        "firmware_version": sensor.firmware_version,
        "calibration": sensor.calibration,
        "is_active": bool(sensor.is_active),
        "is_simulated": sensor.transport == "SIMULATED",
        "last_seen_at": iso(sensor.last_seen_at),
        "last_connection_state": sensor.last_connection_state,
        "bound_at": iso(sensor.bound_at),
        "sync_version": sensor.sync_version,
        "created_at": iso(sensor.created_at),
    }


def for_coolers(db: Session, cooler_ids: list[UUID]) -> dict[UUID, list[dict]]:
    if not cooler_ids:
        return {}
    out: dict[UUID, list[dict]] = {}
    for s in db.query(SensorDevice).filter(SensorDevice.cooler_id.in_(cooler_ids), SensorDevice.is_active.is_(True)):
        out.setdefault(s.cooler_id, []).append(sensor_json(s))
    return out


def _own_cooler(db: Session, cooperative_id: UUID, cooler_id: Optional[UUID]) -> Optional[Cooler]:
    if cooler_id is None:
        return None
    cooler = db.get(Cooler, cooler_id)
    if cooler is None or cooler.cooperative_id != cooperative_id:
        raise field_error("cooler_id", "Choose a cooler from your cooperative.")
    if cooler.status != CoolerStatus.ACTIVE:
        raise field_error("cooler_id", "This cooler has been decommissioned.")
    return cooler


def register(db: Session, principal: Principal, payload: SensorCreate) -> SensorDevice:
    coop_id = principal.cooperative_id
    cooler = _own_cooler(db, coop_id, payload.cooler_id)
    exists = db.query(SensorDevice.id).filter(
        SensorDevice.cooperative_id == coop_id, SensorDevice.sensor_identifier == payload.sensor_identifier
    ).first()
    if exists:
        raise conflict("sensor_identifier", IDENTIFIER_TAKEN)
    now = datetime.datetime.utcnow()
    sensor = SensorDevice(
        cooperative_id=coop_id, **payload.model_dump(exclude={"cooler_id"}),
        cooler_id=cooler.id if cooler else None, bound_at=now if cooler else None,
        bound_by=principal.user.id if cooler else None, is_active=True,
    )
    db.add(sensor)
    try:
        db.flush()
        audit.record(
            db, principal, "SENSOR_REGISTERED", target=f"{sensor.name} ({sensor.transport})",
            entity_type="sensor", entity_id=sensor.id, cooperative_id=coop_id,
            new_values={"sensor_identifier": sensor.sensor_identifier, "transport": sensor.transport},
        )
        if cooler:
            audit.record(
                db, principal, "SENSOR_BOUND", target=f"{sensor.name} -> {cooler.name} ({cooler.code})",
                entity_type="sensor", entity_id=sensor.id, cooperative_id=coop_id,
                new_values={"cooler_id": str(cooler.id)},
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("sensor_identifier", IDENTIFIER_TAKEN)
    db.refresh(sensor)
    return sensor


def update(db: Session, principal: Principal, sensor: SensorDevice, payload: SensorUpdate) -> SensorDevice:
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        raise field_error("name", "This field can't be empty.")
    now = datetime.datetime.utcnow()
    if "cooler_id" in data and data["cooler_id"] != sensor.cooler_id:
        new_cooler = _own_cooler(db, sensor.cooperative_id, data["cooler_id"])
        old_cooler = db.get(Cooler, sensor.cooler_id) if sensor.cooler_id else None
        if old_cooler is not None:
            audit.record(
                db, principal, "SENSOR_UNBOUND", target=f"{sensor.name} from {old_cooler.name} ({old_cooler.code})",
                entity_type="sensor", entity_id=sensor.id, cooperative_id=sensor.cooperative_id,
                old_values={"cooler_id": str(old_cooler.id)},
            )
        if new_cooler is not None:
            audit.record(
                db, principal, "SENSOR_BOUND", target=f"{sensor.name} -> {new_cooler.name} ({new_cooler.code})",
                entity_type="sensor", entity_id=sensor.id, cooperative_id=sensor.cooperative_id,
                new_values={"cooler_id": str(new_cooler.id)},
            )
        sensor.cooler_id = new_cooler.id if new_cooler else None
        sensor.bound_at = now if new_cooler else None
        sensor.bound_by = principal.user.id if new_cooler else None
    for name in ("name", "protocol", "calibration"):
        if name in data:
            setattr(sensor, name, data[name])
    if data.get("is_active") is not None and data["is_active"] != sensor.is_active:
        sensor.is_active = data["is_active"]
        audit.record(
            db, principal, "SENSOR_ACTIVATED" if sensor.is_active else "SENSOR_DEACTIVATED", target=sensor.name,
            entity_type="sensor", entity_id=sensor.id, cooperative_id=sensor.cooperative_id,
        )
    db.commit()
    db.refresh(sensor)
    return sensor


def record_event(db: Session, principal: Principal, event: SensorEventIn) -> tuple[SensorDevice, list]:
    """A device reports that it connected to / lost a sensor. Returns (sensor, new notifications)."""
    sensor = db.get(SensorDevice, event.sensor_id)
    if sensor is None or sensor.cooperative_id != principal.cooperative_id:
        raise field_error("sensor_id", "This sensor isn't registered in your cooperative.")
    notifications = []
    newer = sensor.last_seen_at is None or event.occurred_at >= sensor.last_seen_at
    if newer:
        sensor.last_seen_at = event.occurred_at
        sensor.last_connection_state = event.event
    audit.record(
        db, principal, f"SENSOR_{event.event}", target=sensor.name, entity_type="sensor", entity_id=sensor.id,
        cooperative_id=sensor.cooperative_id, new_values={"occurred_at": iso(event.occurred_at)},
    )
    if newer and event.event == "DISCONNECTED" and sensor.cooler_id and sensor.transport != "SIMULATED":
        cooler = db.get(Cooler, sensor.cooler_id)
        if cooler is not None and cooler.status == CoolerStatus.ACTIVE:
            notifications = cooler_alerts.sensor_disconnected(db, cooler, event.occurred_at, sensor.name)
    db.commit()
    return sensor, notifications
