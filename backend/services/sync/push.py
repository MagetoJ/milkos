"""Applying mutations pushed by offline devices.

Each mutation is applied in its own transaction through the same services the online screens use, so
validation, permissions, tenant isolation and audit entries are identical. The idempotency record
(sync_mutations) is committed in the SAME transaction as the change it describes.

Outcomes
  applied    the change is on the server (`entity` is its current server state)
  duplicate  this (device, mutation_id) - or this client id - was applied before; nothing was done again
  conflict   needs a person: a unique value clashes, or the server changed the record in a way the rules
             below won't override. `entity` carries the server's current version.
  rejected   validation or permission failure; resending the same mutation won't help
  error      unexpected server problem; nothing was saved, the device retries later

Conflict rules
  farmer      create: accepted unless a unique value (number, phone, national ID) is taken -> conflict.
              update: when the server's copy changed since the edit (base_version), a field the device
              changed that the server ALSO changed is a conflict if it's administrative (status, number,
              centre, national ID, payout details); for other fields the device's edit wins.
  centre      server-authoritative: any field changed on both sides is a conflict.
  collection  append-only. A correction (update) only applies to the exact version it was made from;
              otherwise conflict. Corrections are recorded in the audit log with old and new values.
  cooler_reading, sensor_event   append-only events; duplicates collapse onto the original.
  Team members, coolers, payments and settings are server-authoritative and never accepted from sync.

The cooperative is always the caller's own. A payload naming another cooperative is rejected, and every
referenced record (farmer, centre, cooler, collector, sensor) is checked against the caller's cooperative
by the services.
"""
import datetime
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from core.access import Principal
from core.permissions import Permission
from models.centre import CollectionCentre
from models.farmer import Farmer
from models.operations import MilkCollection
from models.sensors import CoolerReading
from models.sync import Device, MutationStatus, SyncMutation
from schemas.auth import UserRole
from schemas.cooperative_module import CentreCreate, CentreUpdate, FarmerCreate, FarmerUpdate
from schemas.platform import CollectionCreate, CollectionUpdate
from schemas.sync import CoolerReadingIn, Mutation, SensorEventIn
from services import audit, centres, collections, cooler_readings, farmers, notifications, sensors
from services.common import SyncOrigin
from services.sync import serializers

logger = logging.getLogger("milkflow.sync")

STAFF = {UserRole.COOP_ADMIN.value, UserRole.MANAGER.value}
FIELD_STAFF = STAFF | {UserRole.COLLECTOR.value}
FARMER_SENSITIVE = {"status", "farmer_number", "centre_id", "national_id", "payment_method", "payment_account", "bank_name"}
REF_FIELDS = ("farmer_id", "centre_id", "cooler_id", "collector_id", "sensor_id")


class Refused(Exception):
    def __init__(self, status: str, code: str, message: str, fields: Optional[dict] = None, entity: Optional[dict] = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.fields = fields or {}
        self.entity = entity


def _rejected(code: str, message: str, fields: Optional[dict] = None) -> Refused:
    return Refused("rejected", code, message, fields)


@dataclass
class Ctx:
    db: Session
    principal: Principal
    device: Device
    mutation: Mutation
    record: SyncMutation
    payload: dict
    notifications: list = field(default_factory=list)


@dataclass
class Applied:
    entity_type: str
    server_id: str
    duplicate: bool = False


# ---------------- helpers ----------------

def _require_role(ctx: Ctx, roles: set[str], permission: Optional[Permission] = None) -> None:
    if ctx.principal.role not in roles or (permission is not None and not ctx.principal.can(permission)):
        raise _rejected("forbidden", "Your role can't make this change.")


def _parse(model: type[BaseModel], payload: dict) -> BaseModel:
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        fields = {}
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", ()) if p != "body"]
            fields.setdefault(loc[-1] if loc else "form", err.get("msg", "Invalid value."))
        raise _rejected("validation", next(iter(fields.values()), "Invalid data."), fields)


def _no_foreign_cooperative(ctx: Ctx) -> None:
    named = ctx.payload.pop("cooperative_id", None)
    if named is not None and str(named) != str(ctx.principal.cooperative_id):
        raise _rejected("forbidden", "You can only change your own cooperative's records.")


def _resolve_refs(ctx: Ctx) -> None:
    """Replace client ids of records whose server id differs (rare) using this device's mutation log."""
    values = [str(ctx.payload[k]) for k in REF_FIELDS if ctx.payload.get(k)]
    if not values:
        return
    mapping = dict(
        ctx.db.query(SyncMutation.local_id, SyncMutation.server_id).filter(
            SyncMutation.device_id == ctx.device.id, SyncMutation.local_id.in_(values),
            SyncMutation.status == MutationStatus.APPLIED, SyncMutation.server_id != SyncMutation.local_id,
        ).all()
    )
    for key in REF_FIELDS:
        value = ctx.payload.get(key)
        if value and str(value) in mapping:
            ctx.payload[key] = mapping[str(value)]


def _server_id_for_create(ctx: Ctx, model) -> tuple[UUID, Optional[Any]]:
    """(id to create with, existing row if this very record already exists for the caller)."""
    local = ctx.mutation.local_id
    row = ctx.db.get(model, local)
    if row is None:
        return local, None
    if getattr(row, "cooperative_id", None) == ctx.principal.cooperative_id:
        return local, row  # created earlier (its idempotency record was lost): a duplicate, not a new row
    return uuid4(), None  # the id is taken elsewhere: use a fresh server id and report it back


def _norm(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    return value


def _stale_fields(ctx: Ctx, row, changes: dict, fields: Optional[set[str]]) -> dict:
    """Fields the device changed that the server also changed since `base_version`."""
    m = ctx.mutation
    if m.base_version is None or row.sync_version == m.base_version:
        return {}
    base = m.base or {}
    clashes = {}
    for name, value in changes.items():
        if fields is not None and name not in fields:
            continue
        server_now = _norm(getattr(row, name, None))
        if name in base:
            server_changed = _norm(base[name]) != server_now
        else:
            server_changed = True  # no baseline to compare: assume it may have changed
        if server_changed and _norm(value) != server_now:
            clashes[name] = "Changed on the server since you edited it offline."
    return clashes


def _own_row(ctx: Ctx, model, what: str):
    row = ctx.db.get(model, ctx.mutation.local_id)
    if row is None or row.cooperative_id != ctx.principal.cooperative_id:
        raise _rejected("not_found", f"{what} not found")
    return row


# ---------------- handlers ----------------

def farmer_create(ctx: Ctx) -> Applied:
    _require_role(ctx, STAFF, Permission.FARMER_CREATE)
    _no_foreign_cooperative(ctx)
    payload = _parse(FarmerCreate, ctx.payload)
    server_id, existing = _server_id_for_create(ctx, Farmer)
    if existing is not None:
        return Applied("farmer", str(existing.id), duplicate=True)
    ctx.record.server_id = str(server_id)
    farmers.create(ctx.db, ctx.principal, payload, SyncOrigin(entity_id=server_id, device_id=ctx.device.id))
    return Applied("farmer", str(server_id))


def farmer_update(ctx: Ctx) -> Applied:
    _require_role(ctx, STAFF, Permission.FARMER_UPDATE)
    _no_foreign_cooperative(ctx)
    row = _own_row(ctx, Farmer, "Farmer")
    payload = _parse(FarmerUpdate, ctx.payload)
    clashes = _stale_fields(ctx, row, payload.model_dump(exclude_unset=True), FARMER_SENSITIVE)
    if clashes:
        raise Refused("conflict", "conflict", "This farmer was changed on the server while you were offline.", clashes)
    farmers.update(ctx.db, ctx.principal, row, payload)
    return Applied("farmer", str(row.id))


def centre_create(ctx: Ctx) -> Applied:
    _require_role(ctx, STAFF)
    _no_foreign_cooperative(ctx)
    payload = _parse(CentreCreate, ctx.payload)
    server_id, existing = _server_id_for_create(ctx, CollectionCentre)
    if existing is not None:
        return Applied("centre", str(existing.id), duplicate=True)
    ctx.record.server_id = str(server_id)
    centres.create(ctx.db, ctx.principal, payload, SyncOrigin(entity_id=server_id, device_id=ctx.device.id))
    return Applied("centre", str(server_id))


def centre_update(ctx: Ctx) -> Applied:
    _require_role(ctx, STAFF)
    _no_foreign_cooperative(ctx)
    row = _own_row(ctx, CollectionCentre, "Collection centre")
    payload = _parse(CentreUpdate, ctx.payload)
    clashes = _stale_fields(ctx, row, payload.model_dump(exclude_unset=True), None)
    if clashes:
        raise Refused("conflict", "conflict", "This centre's settings were changed on the server.", clashes)
    centres.update(ctx.db, ctx.principal, row, payload)
    return Applied("centre", str(row.id))


def collection_create(ctx: Ctx) -> Applied:
    _require_role(ctx, FIELD_STAFF, Permission.COLLECTION_CREATE)
    _no_foreign_cooperative(ctx)
    payload = _parse(CollectionCreate, ctx.payload)
    server_id, existing = _server_id_for_create(ctx, MilkCollection)
    if existing is not None:
        return Applied("collection", str(existing.id), duplicate=True)
    ctx.record.server_id = str(server_id)
    origin = SyncOrigin(
        entity_id=server_id, device_id=ctx.device.id,
        client_recorded_at=ctx.mutation.client_timestamp.replace(tzinfo=None) if ctx.mutation.client_timestamp else None,
    )
    collections.create(ctx.db, ctx.principal, payload, origin)
    return Applied("collection", str(server_id))


def collection_update(ctx: Ctx) -> Applied:
    _require_role(ctx, STAFF, Permission.COLLECTION_UPDATE)
    _no_foreign_cooperative(ctx)
    row = _own_row(ctx, MilkCollection, "Collection")
    payload = _parse(CollectionUpdate, ctx.payload)
    if ctx.mutation.base_version is None or row.sync_version != ctx.mutation.base_version:
        raise Refused(
            "conflict", "conflict",
            "This collection was corrected on the server since you edited it. Review it before correcting again.",
            {name: "Changed on the server." for name in payload.model_dump(exclude_unset=True)},
        )
    collections.update(ctx.db, ctx.principal, row, payload)
    return Applied("collection", str(row.id))


def reading_create(ctx: Ctx) -> Applied:
    _require_role(ctx, FIELD_STAFF, Permission.COOLER_READ)
    _no_foreign_cooperative(ctx)
    data = _parse(CoolerReadingIn, ctx.payload)
    reading_id, existing = _server_id_for_create(ctx, CoolerReading)
    if existing is not None:
        return Applied("cooler_reading", str(existing.id), duplicate=True)
    ctx.record.server_id = str(reading_id)
    reading, duplicate, created = cooler_readings.record(
        ctx.db, ctx.principal, data, reading_id=reading_id, device_id=ctx.device.id,
    )
    ctx.notifications += [n.id for n in created]
    if duplicate:
        # The same measurement arrived before under another mutation: point this one at it.
        ctx.record.server_id = str(reading.id)
    return Applied("cooler_reading", str(reading.id), duplicate=duplicate)


def sensor_event_create(ctx: Ctx) -> Applied:
    _require_role(ctx, FIELD_STAFF, Permission.COOLER_READ)
    _no_foreign_cooperative(ctx)
    data = _parse(SensorEventIn, ctx.payload)
    sensor, created = sensors.record_event(ctx.db, ctx.principal, data)
    ctx.notifications += [n.id for n in created]
    ctx.record.server_id = str(sensor.id)
    return Applied("sensor", str(sensor.id))


HANDLERS: dict[tuple[str, str], Callable[[Ctx], Applied]] = {
    ("farmer", "create"): farmer_create,
    ("farmer", "update"): farmer_update,
    ("centre", "create"): centre_create,
    ("centre", "update"): centre_update,
    ("collection", "create"): collection_create,
    ("collection", "update"): collection_update,
    ("cooler_reading", "create"): reading_create,
    ("sensor_event", "create"): sensor_event_create,
}


# ---------------- driver ----------------

def _http_refusal(exc: HTTPException) -> Refused:
    detail = exc.detail
    fields: dict[str, str] = {}
    message = detail if isinstance(detail, str) else "The server refused this change."
    if isinstance(detail, list):
        for item in detail:
            loc = [str(p) for p in item.get("loc", []) if p != "body"]
            fields.setdefault(loc[-1] if loc else "form", item.get("msg", "Invalid value."))
        message = next(iter(fields.values()), message)
    if exc.status_code == 409:
        return Refused("conflict", "conflict", message, fields)
    code = {403: "forbidden", 404: "not_found"}.get(exc.status_code, "validation")
    return Refused("rejected", code, message, fields)


def _result(m: Mutation, status: str, *, server_id=None, entity=None, error=None) -> dict:
    return {
        "mutation_id": m.mutation_id, "entity_type": m.entity_type, "local_id": m.local_id, "status": status,
        "server_id": str(server_id) if server_id else None,
        "server_version": entity.get("sync_version") if isinstance(entity, dict) else None,
        "entity": entity, "error": error,
    }


def _entity(db: Session, principal: Principal, entity_type: str, server_id) -> Optional[dict]:
    return serializers.one(db, principal, entity_type, server_id) if server_id else None


def _entity_type_of(m: Mutation) -> str:
    return "sensor" if m.entity_type == "sensor_event" else m.entity_type


def apply_one(db: Session, principal: Principal, device: Device, m: Mutation, pending_notifications: list) -> dict:
    record = db.query(SyncMutation).filter(
        SyncMutation.device_id == device.id, SyncMutation.mutation_id == m.mutation_id
    ).first()
    if record is not None and (record.entity_type != m.entity_type or record.local_id != str(m.local_id)):
        return _result(m, "rejected", error={"code": "validation", "message": "This mutation id was already used for another change.", "fields": {}})
    if record is not None and record.status == MutationStatus.APPLIED:
        logger.info("sync_mutation_duplicate device=%s mutation=%s", device.id, m.mutation_id)
        return _result(m, "duplicate", server_id=record.server_id,
                       entity=_entity(db, principal, _entity_type_of(m), record.server_id))

    handler = HANDLERS.get((m.entity_type, m.operation))
    if handler is None:
        return _result(m, "rejected", error={"code": "validation", "message": f"{m.entity_type} {m.operation} can't be synced.", "fields": {}})

    if record is None:
        record = SyncMutation(device_id=device.id, mutation_id=m.mutation_id)
        db.add(record)
    record.user_id = principal.user.id
    record.cooperative_id = principal.cooperative_id
    record.entity_type = m.entity_type
    record.operation = m.operation
    record.local_id = str(m.local_id)
    record.server_id = str(m.local_id)
    record.status = MutationStatus.APPLIED
    record.error_code = record.error_message = None
    record.client_timestamp = m.client_timestamp.replace(tzinfo=None) if m.client_timestamp else None
    record.received_at = datetime.datetime.utcnow()

    ctx = Ctx(db=db, principal=principal, device=device, mutation=m, record=record, payload=dict(m.payload))
    try:
        _resolve_refs(ctx)
        outcome = handler(ctx)
        record.server_id = outcome.server_id
        db.commit()  # the services commit their change; this also covers a no-op change or a duplicate
    except (Refused, HTTPException) as exc:
        db.rollback()
        refusal = exc if isinstance(exc, Refused) else _http_refusal(exc)
        entity = None
        if refusal.status == "conflict" and m.operation == "update":
            entity = _entity(db, principal, _entity_type_of(m), m.local_id)
        _record_failure(db, principal, device, m, refusal)
        logger.info(
            "sync_mutation_%s device=%s mutation=%s entity=%s op=%s code=%s",
            refusal.status, device.id, m.mutation_id, m.entity_type, m.operation, refusal.code,
        )
        return _result(m, refusal.status, entity=entity,
                       error={"code": refusal.code, "message": refusal.message, "fields": refusal.fields})
    except Exception:
        db.rollback()
        logger.exception("sync_mutation_error device=%s mutation=%s entity=%s", device.id, m.mutation_id, m.entity_type)
        return _result(m, "error", error={"code": "server_error", "message": "The server couldn't save this change. It will be retried.", "fields": {}})

    pending_notifications += ctx.notifications
    status = "duplicate" if outcome.duplicate else "applied"
    logger.info("sync_mutation_%s device=%s mutation=%s entity=%s op=%s server_id=%s",
                "accepted" if status == "applied" else status, device.id, m.mutation_id, m.entity_type, m.operation,
                outcome.server_id)
    return _result(m, status, server_id=outcome.server_id,
                   entity=_entity(db, principal, outcome.entity_type, outcome.server_id))


def _record_failure(db: Session, principal: Principal, device: Device, m: Mutation, refusal: Refused) -> None:
    """Keep a record of refused mutations for support and for the conflict review (not an idempotency key)."""
    record = db.query(SyncMutation).filter(
        SyncMutation.device_id == device.id, SyncMutation.mutation_id == m.mutation_id
    ).first()
    if record is None:
        record = SyncMutation(device_id=device.id, mutation_id=m.mutation_id)
        db.add(record)
    record.user_id = principal.user.id
    record.cooperative_id = principal.cooperative_id
    record.entity_type = m.entity_type
    record.operation = m.operation
    record.local_id = str(m.local_id)
    record.server_id = None
    record.status = MutationStatus.CONFLICT if refusal.status == "conflict" else MutationStatus.REJECTED
    record.error_code = refusal.code
    record.error_message = refusal.message[:2000]
    record.received_at = datetime.datetime.utcnow()
    if refusal.status == "conflict":
        audit.record(
            db, principal, "SYNC_CONFLICT", target=f"{m.entity_type} {m.operation}: {refusal.message}",
            entity_type=m.entity_type, entity_id=m.local_id, cooperative_id=principal.cooperative_id,
            new_values={"mutation_id": str(m.mutation_id), "fields": refusal.fields},
        )
    db.commit()


def push(db: Session, principal: Principal, device: Device, mutations: list[Mutation]) -> list[dict]:
    started = datetime.datetime.utcnow()
    pending_notifications: list = []
    results = [apply_one(db, principal, device, m, pending_notifications) for m in mutations]

    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    device.last_sync_at = datetime.datetime.utcnow()
    if counts.get("applied") or counts.get("conflict") or counts.get("rejected"):
        audit.record(
            db, principal, "SYNC_BATCH_RECEIVED",
            target=f"{len(mutations)} offline change(s) from device {device.label or device.device_identifier[:8]}: "
                   + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())),
            entity_type="device", entity_id=device.id, cooperative_id=principal.cooperative_id,
            new_values={"counts": counts, "entity_types": sorted({m.entity_type for m in mutations})},
        )
    db.commit()
    logger.info(
        "sync_push device=%s user=%s mutations=%s results=%s ms=%s", device.id, principal.user.id, len(mutations),
        counts, int((datetime.datetime.utcnow() - started).total_seconds() * 1000),
    )

    # SMS only after everything above is committed; failures never touch the readings.
    if pending_notifications:
        notifications.dispatch(db, pending_notifications, principal)
    if principal.cooperative_id is not None:
        notifications.dispatch_due(db, principal.cooperative_id, principal)
    return results


def resolve_conflict(db: Session, principal: Principal, device: Device, mutation_id: UUID, resolution: str) -> bool:
    record = db.query(SyncMutation).filter(
        SyncMutation.device_id == device.id, SyncMutation.mutation_id == mutation_id,
        SyncMutation.user_id == principal.user.id,
    ).first()
    if record is None or record.status not in (MutationStatus.CONFLICT, MutationStatus.REJECTED):
        return False
    record.resolved_at = datetime.datetime.utcnow()
    record.resolution = resolution
    audit.record(
        db, principal, "SYNC_CONFLICT_RESOLVED",
        target=f"{record.entity_type} {record.operation} {resolution} on device {device.label or device.device_identifier[:8]}",
        entity_type=record.entity_type, entity_id=record.local_id, cooperative_id=principal.cooperative_id,
        new_values={"mutation_id": str(mutation_id), "resolution": resolution},
    )
    db.commit()
    return True
