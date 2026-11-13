"""Offline sync, device and sensor bodies (app/api/routers/sync.py, devices.py, sensor endpoints).

Sync protocol (all endpoints need the normal access token plus the `X-Device-Id` header of a device
registered for the caller through POST /api/v1/devices/register):

  PUSH  POST /api/v1/sync/push   {mutations: [...]}  ->  one result per mutation, in order
        Every mutation carries a client-generated `mutation_id`; (device, mutation_id) is the idempotency
        key, so a resent mutation returns "duplicate" with the original outcome instead of applying twice.
        Creates also carry `local_id`, reused as the server id (a second guard against duplicates).
  PULL  GET  /api/v1/sync/pull?cursor=N  ->  changes after server cursor N (monotonic sequence)
  STATUS GET /api/v1/sync/status

The cooperative is ALWAYS the caller's own (from the database). A `cooperative_id` inside a payload is
never used for authorization; one naming another cooperative is rejected.
"""
import datetime as dt
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

EntityType = Literal["farmer", "centre", "collection", "collection_batch", "cooler_reading", "sensor_event"]
Operation = Literal["create", "update"]
MutationOutcome = Literal["applied", "duplicate", "conflict", "rejected", "error"]


class _Body(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


# ---------------- devices / offline sessions ----------------

class DeviceRegister(_Body):
    device_identifier: str = Field(..., min_length=8, max_length=64, pattern=r"^[A-Za-z0-9\-]+$")
    platform: str | None = Field(None, max_length=100)
    app_version: str | None = Field(None, max_length=50)
    label: str | None = Field(None, max_length=100)


class DeviceSessionToken(_Body):
    device_identifier: str = Field(..., min_length=8, max_length=64)
    session_token: str = Field(..., min_length=20, max_length=200)


class DeviceUpdate(_Body):
    is_active: bool | None = None
    label: str | None = Field(None, max_length=100)


# ---------------- push ----------------

class Mutation(_Body):
    mutation_id: UUID
    entity_type: EntityType
    operation: Operation
    local_id: UUID = Field(..., description="Client id of the record; reused as the server id for creates.")
    base_version: int | None = Field(None, ge=0, description="sync_version the edit was based on (updates).")
    base: dict[str, Any] | None = Field(None, description="Field values the edit started from (updates).")
    client_timestamp: dt.datetime | None = Field(None, description="Device clock; metadata only.")
    payload: dict[str, Any]


class PushRequest(_Body):
    mutations: list[Mutation] = Field(..., min_length=1, max_length=200)


class MutationError(BaseModel):
    code: str                 # validation | conflict | forbidden | not_found | server_error
    message: str
    fields: dict[str, str] = {}


class MutationResult(BaseModel):
    mutation_id: UUID
    entity_type: str
    local_id: UUID
    status: MutationOutcome
    server_id: str | None = None
    server_version: int | None = None
    entity: dict[str, Any] | None = None
    error: MutationError | None = None


class PushResponse(BaseModel):
    results: list[MutationResult]
    cursor: int
    server_time: str


# ---------------- pull ----------------

class Change(BaseModel):
    seq: int
    entity_type: str
    entity_id: str
    op: Literal["upsert", "delete"]
    data: dict[str, Any] | None = None


class PullResponse(BaseModel):
    changes: list[Change]
    cursor: int
    has_more: bool
    server_time: str
    window: dict[str, Any]


class ConflictResolution(_Body):
    mutation_id: UUID
    resolution: Literal["discarded", "retried", "edited"]


# ---------------- sensors ----------------

SensorTransportIn = Literal["BLUETOOTH_LE", "NATIVE_BRIDGE", "SIMULATED"]


class SensorCreate(_Body):
    name: str = Field(..., min_length=2, max_length=255)
    sensor_identifier: str = Field(..., min_length=1, max_length=128)
    sensor_type: str = Field(..., min_length=2, max_length=40, pattern=r"^[A-Z0-9_]+$")
    transport: SensorTransportIn
    protocol: str | None = Field(None, max_length=80)
    bluetooth_device_id: str | None = Field(None, max_length=255)
    bluetooth_name: str | None = Field(None, max_length=255)
    firmware_version: str | None = Field(None, max_length=50)
    calibration: dict[str, Any] | None = None
    cooler_id: UUID | None = None


class SensorUpdate(_Body):
    name: str | None = Field(None, min_length=2, max_length=255)
    protocol: str | None = Field(None, max_length=80)
    calibration: dict[str, Any] | None = None
    cooler_id: UUID | None = None   # null unbinds
    is_active: bool | None = None


ReadingSourceIn = Literal["BLUETOOTH", "NATIVE_BRIDGE", "MANUAL", "SIMULATED"]


class CoolerReadingIn(_Body):
    cooler_id: UUID
    sensor_id: UUID | None = None
    volume_litres: float | None = Field(None, ge=0, le=1_000_000)
    temperature_celsius: float | None = Field(None, ge=-30, le=80)
    battery_percent: int | None = Field(None, ge=0, le=100)
    signal_strength: int | None = Field(None, ge=-150, le=20)
    measured_at: dt.datetime
    source: ReadingSourceIn
    measurement_id: str | None = Field(None, max_length=120, description="Sensor's own event id, if any.")
    sequence: int | None = Field(None, ge=0)

    @field_validator("measured_at")
    @classmethod
    def naive_utc(cls, v: dt.datetime) -> dt.datetime:
        if v.tzinfo is not None:
            v = v.astimezone(dt.UTC).replace(tzinfo=None)
        return v


class SensorEventIn(_Body):
    sensor_id: UUID
    event: Literal["CONNECTED", "DISCONNECTED"]
    occurred_at: dt.datetime

    @field_validator("occurred_at")
    @classmethod
    def naive_utc(cls, v: dt.datetime) -> dt.datetime:
        if v.tzinfo is not None:
            v = v.astimezone(dt.UTC).replace(tzinfo=None)
        return v
