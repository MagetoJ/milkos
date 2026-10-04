"""Cooler sensors and their measurements.

Bluetooth is only the transport: a level or weight sensor feeds a microcontroller, which a MilkOS device
reads over Bluetooth (or a future native bridge) and stores as a cooler reading. Readings are
append-only measurement events; a correction is a new reading, never an edit.
"""
import datetime
import uuid

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Uuid, true,
)
from sqlalchemy.dialects.postgresql import JSONB

from db import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class SensorTransport:
    BLUETOOTH_LE = "BLUETOOTH_LE"
    NATIVE_BRIDGE = "NATIVE_BRIDGE"  # future Android app reading the sensor natively
    SIMULATED = "SIMULATED"          # development simulator; never a real measurement

    ALL = (BLUETOOTH_LE, NATIVE_BRIDGE, SIMULATED)


class SensorDevice(Base):
    __tablename__ = "sensor_devices"
    __table_args__ = (
        Index("uq_sensor_devices_cooperative_identifier", "cooperative_id", "sensor_identifier", unique=True),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True, index=True)
    # The hardware's own identity (serial number, or the id the browser gives a paired Bluetooth device).
    sensor_identifier = Column(String(128), nullable=False)
    name = Column(String(255), nullable=False)
    sensor_type = Column(String(40), nullable=False)        # e.g. ULTRASONIC_LEVEL, LOAD_CELL, PRESSURE_LEVEL
    transport = Column(String(20), nullable=False)          # SensorTransport
    protocol = Column(String(80))                           # adapter key on the client; NULL = not chosen yet
    bluetooth_device_id = Column(String(255))
    bluetooth_name = Column(String(255))
    firmware_version = Column(String(50))
    # Free-form calibration for the protocol adapter (tank geometry, offsets, scale factor...).
    calibration = Column(JSON_TYPE)
    is_active = Column(Boolean, nullable=False, default=True, server_default=true())
    last_seen_at = Column(DateTime)
    last_connection_state = Column(String(20))  # CONNECTED / DISCONNECTED as last reported by a device
    bound_at = Column(DateTime)
    bound_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sync_version = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ReadingSource:
    BLUETOOTH = "BLUETOOTH"
    NATIVE_BRIDGE = "NATIVE_BRIDGE"
    MANUAL = "MANUAL"        # dipstick / gauge typed in by a person
    SIMULATED = "SIMULATED"

    ALL = (BLUETOOTH, NATIVE_BRIDGE, MANUAL, SIMULATED)


class ReadingQuality:
    VALID = "VALID"
    SUSPICIOUS = "SUSPICIOUS"  # stored as received, but kept out of the cooler's current level and alerts
    SIMULATED = "SIMULATED"


class CoolerReading(Base):
    __tablename__ = "cooler_readings"
    __table_args__ = (
        # A sensor resending the same measurement after reconnecting maps to the same key.
        Index("uq_cooler_readings_cooler_measurement", "cooler_id", "measurement_key", unique=True),
        Index("ix_cooler_readings_cooler_measured", "cooler_id", "measured_at"),
        Index("ix_cooler_readings_coop_measured", "cooperative_id", "measured_at"),
        Index("ix_cooler_readings_measured_at", "measured_at"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="CASCADE"), nullable=False)
    sensor_id = Column(Uuid, ForeignKey("sensor_devices.id", ondelete="SET NULL"), nullable=True)
    volume_litres = Column(Numeric(10, 2), nullable=True)
    temperature_celsius = Column(Numeric(5, 2))
    battery_percent = Column(Integer)
    signal_strength = Column(Integer)  # RSSI in dBm, when the transport reports it
    measured_at = Column(DateTime, nullable=False)   # device's measurement time (metadata)
    received_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)  # server time
    device_id = Column(Uuid, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    recorded_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source = Column(String(20), nullable=False)
    quality = Column(String(20), nullable=False, default=ReadingQuality.VALID)
    quality_flags = Column(JSON_TYPE)
    measurement_key = Column(String(255), nullable=False)
    sequence = Column(Integer)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
