"""Cooler readings: validation, quality flags, idempotent storage and the cooler's current level.

A reading is never silently discarded. Clearly invalid input (negative volume, impossible values) is
refused by the schema; implausible but possible readings are STORED and marked SUSPICIOUS with the
reasons, and kept out of the cooler's current level and alerts.

Duplicates: a sensor resending a measurement after reconnecting maps to the same `measurement_key`
(the sensor's own event id when it has one, otherwise sensor + measurement time + sequence), which is
unique per cooler. The device-generated reading id is a second guard.
"""
import datetime
import logging
import os
from typing import Optional
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import field_error, iso, num
from models.admin import Cooler, CoolerStatus
from models.sensors import CoolerReading, ReadingQuality, ReadingSource, SensorDevice
from schemas.sync import CoolerReadingIn
from services import cooler_alerts

logger = logging.getLogger("milkflow.sensors")

FUTURE_TOLERANCE = datetime.timedelta(minutes=5)
MAX_AGE = datetime.timedelta(days=30)
CAPACITY_TOLERANCE = 1.05


def accept_simulated() -> bool:
    return os.getenv("SENSOR_ACCEPT_SIMULATED", "true").strip().lower() in {"1", "true", "yes", "on"}


def reading_json(r: CoolerReading) -> dict:
    return {
        "id": str(r.id),
        "cooperative_id": str(r.cooperative_id),
        "cooler_id": str(r.cooler_id),
        "sensor_id": str(r.sensor_id) if r.sensor_id else None,
        "volume_litres": num(r.volume_litres),
        "temperature_celsius": num(r.temperature_celsius),
        "battery_percent": r.battery_percent,
        "signal_strength": r.signal_strength,
        "measured_at": iso(r.measured_at),
        "received_at": iso(r.received_at),
        "device_id": str(r.device_id) if r.device_id else None,
        "source": r.source,
        "quality": r.quality,
        "quality_flags": r.quality_flags or [],
        "measurement_key": r.measurement_key,
        "created_at": iso(r.created_at),
    }


def measurement_key(data: CoolerReadingIn) -> str:
    who = str(data.sensor_id) if data.sensor_id else data.source.lower()
    if data.measurement_id:
        return f"m:{who}:{data.measurement_id}"[:255]
    stamp = data.measured_at.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    return f"t:{who}:{stamp}:{data.sequence if data.sequence is not None else ''}"[:255]


def _quality(cooler: Cooler, sensor: Optional[SensorDevice], data: CoolerReadingIn, now: datetime.datetime) -> tuple[str, list[str]]:
    flags: list[str] = []
    capacity = num(cooler.capacity_litres)
    if data.volume_litres is not None and capacity and data.volume_litres > capacity * CAPACITY_TOLERANCE:
        flags.append("above_capacity")
    if data.measured_at > now + FUTURE_TOLERANCE:
        flags.append("future_timestamp")
    if data.measured_at < now - MAX_AGE:
        flags.append("very_old_timestamp")
    if data.temperature_celsius is not None and not (-5 <= data.temperature_celsius <= 40):
        flags.append("implausible_temperature")
    if sensor is not None:
        if sensor.cooler_id != cooler.id:
            flags.append("sensor_not_bound_to_cooler")
        if not sensor.is_active:
            flags.append("sensor_inactive")
        expected = {"BLUETOOTH_LE": ReadingSource.BLUETOOTH, "NATIVE_BRIDGE": ReadingSource.NATIVE_BRIDGE,
                    "SIMULATED": ReadingSource.SIMULATED}.get(sensor.transport)
        if expected and data.source != expected:
            flags.append("source_mismatch")
    elif data.source in (ReadingSource.BLUETOOTH, ReadingSource.NATIVE_BRIDGE):
        flags.append("unregistered_sensor")
    if data.volume_litres is None and data.temperature_celsius is None and data.battery_percent is None:
        flags.append("empty_reading")

    if flags:
        return ReadingQuality.SUSPICIOUS, flags
    if data.source == ReadingSource.SIMULATED:
        return ReadingQuality.SIMULATED, ["simulated"]
    return ReadingQuality.VALID, []


def record(
    db: Session, principal: Principal, data: CoolerReadingIn, *, reading_id: Optional[UUID] = None,
    device_id: Optional[UUID] = None,
) -> tuple[CoolerReading, bool, list]:
    """Store one reading. Returns (reading, was_duplicate, notifications created). Commits."""
    cooler = db.get(Cooler, data.cooler_id)
    if cooler is None or cooler.cooperative_id != principal.cooperative_id:
        raise field_error("cooler_id", "This cooler isn't part of your cooperative.")
    if cooler.status != CoolerStatus.ACTIVE:
        raise field_error("cooler_id", "This cooler has been decommissioned.")
    sensor = None
    if data.sensor_id is not None:
        sensor = db.get(SensorDevice, data.sensor_id)
        if sensor is None or sensor.cooperative_id != principal.cooperative_id:
            raise field_error("sensor_id", "This sensor isn't registered in your cooperative.")
    if data.source == ReadingSource.SIMULATED and not accept_simulated():
        raise field_error("source", "Simulated readings are not accepted by this server.")

    key = measurement_key(data)
    existing = db.query(CoolerReading).filter(
        CoolerReading.cooler_id == cooler.id, CoolerReading.measurement_key == key
    ).first()
    if existing is None and reading_id is not None:
        same_id = db.get(CoolerReading, reading_id)
        if same_id is not None:
            if same_id.cooperative_id != principal.cooperative_id:
                raise field_error("cooler_id", "This cooler isn't part of your cooperative.")
            existing = same_id
    if existing is not None:
        return existing, True, []

    now = datetime.datetime.utcnow()
    quality, flags = _quality(cooler, sensor, data, now)
    reading = CoolerReading(
        **({"id": reading_id} if reading_id else {}),
        cooperative_id=cooler.cooperative_id, cooler_id=cooler.id, sensor_id=sensor.id if sensor else None,
        volume_litres=data.volume_litres, temperature_celsius=data.temperature_celsius,
        battery_percent=data.battery_percent, signal_strength=data.signal_strength,
        measured_at=data.measured_at, received_at=now, device_id=device_id, recorded_by=principal.user.id,
        source=data.source, quality=quality, quality_flags=flags or None, measurement_key=key, sequence=data.sequence,
    )
    db.add(reading)

    if sensor is not None and (sensor.last_seen_at is None or data.measured_at > sensor.last_seen_at):
        sensor.last_seen_at = min(data.measured_at, now)
    cooler.last_seen_at = now
    # Only a trustworthy reading newer than the current one moves the cooler's level.
    if quality != ReadingQuality.SUSPICIOUS and (cooler.last_reading_at is None or data.measured_at >= cooler.last_reading_at):
        if data.volume_litres is not None:
            cooler.current_volume_litres = data.volume_litres
        if data.temperature_celsius is not None:
            cooler.last_temperature_c = data.temperature_celsius
        cooler.last_reading_at = data.measured_at

    try:
        db.flush()
    except IntegrityError:
        # The same measurement arrived concurrently from another request.
        db.rollback()
        existing = db.query(CoolerReading).filter(
            CoolerReading.cooler_id == data.cooler_id, CoolerReading.measurement_key == key
        ).first()
        if existing is not None:
            return existing, True, []
        raise
    notifications = cooler_alerts.evaluate_reading(db, cooler, reading)
    db.commit()
    db.refresh(reading)
    logger.info(
        "sensor_reading_%s reading=%s cooler=%s source=%s quality=%s flags=%s",
        "accepted" if quality != ReadingQuality.SUSPICIOUS else "flagged", reading.id, cooler.id, data.source,
        quality, ",".join(flags) or "-",
    )
    return reading, False, notifications
