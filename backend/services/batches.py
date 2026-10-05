"""Collection batches: one weighing allocated to one or more farmers, confirmed in a single transaction.

Rules (all enforced here, on the server, whatever the client sent):
  - the batch, its centre, cooler, collector and every farmer belong to the caller's cooperative;
  - a collector always records as themselves; staff may name an active collector of their cooperative;
  - every allocation is > 0 KG, one line per farmer, and the lines add up to no more than the captured weight
    (the remainder is reported as remaining_weight_kg);
  - a confirmed batch is never edited: corrections and reversals go through services/corrections.py.
Each allocation line is a MilkCollection, so existing reports, farmer statements and payments see it.
"""
import datetime
import secrets
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from core.access import Principal, cooperative_scope
from core.utils import field_error, iso, num
from models.admin import Cooler, CoolerStatus
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.notifications import Notification
from models.operations import (
    BatchStatus, CollectionBatch, Collector, LineStatus, MilkCollection, QualityStatus, WeightSource,
)
from models.user import User
from schemas.auth import UserRole
from services import audit, settings
from services.common import SyncOrigin, target_cooperative

CENT = Decimal("0.01")
REJECTION_MIN = 3


def kg(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def density(db: Session) -> Decimal:
    return Decimal(str(settings.get(db, "collection.density_kg_per_litre") or 1.03)).quantize(Decimal("0.0001"))


def litres_from_kg(weight: Decimal, factor: Decimal) -> Decimal:
    return (weight / factor).quantize(CENT, rounding=ROUND_HALF_UP)


def reference(db: Session, model, prefix: str, day: datetime.date) -> str:
    for _ in range(10):
        ref = f"{prefix}-{day:%y%m%d}-{secrets.token_hex(3).upper()}"
        if not db.query(model.id).filter(model.reference == ref).first():
            return ref
    return f"{prefix}-{day:%y%m%d}-{secrets.token_hex(6).upper()}"


def automatic_quality(db: Session, temperature: Optional[float], fat: Optional[float]) -> Optional[str]:
    """Reason to reject under the platform's quality thresholds, if any applies."""
    max_temp = settings.get(db, "collection.max_temperature_c")
    min_fat = settings.get(db, "collection.min_fat_percentage")
    if max_temp is not None and temperature is not None and temperature > max_temp:
        return f"Temperature {temperature:g}°C is above the {max_temp:g}°C limit."
    if min_fat is not None and fat is not None and fat < min_fat:
        return f"Butterfat {fat:g}% is below the {min_fat:g}% minimum."
    return None


def resolve_quality(db: Session, quality_status: Optional[str], reason: Optional[str], temperature, fat):
    if quality_status is None:
        auto = automatic_quality(db, temperature, fat)
        quality_status, reason = (QualityStatus.REJECTED, auto) if auto else (QualityStatus.ACCEPTED, None)
    if quality_status == QualityStatus.REJECTED and not (reason and len(reason.strip()) >= REJECTION_MIN):
        raise field_error("rejection_reason", "Say why this milk was rejected.")
    return quality_status, reason if quality_status == QualityStatus.REJECTED else None


# ---------------- validation of references (tenant isolation) ----------------

def resolve_collector(db: Session, principal: Principal, cooperative_id: UUID, collector_id: Optional[UUID]) -> Optional[Collector]:
    """A collector records under their own profile; staff may name any active collector of the cooperative."""
    if principal.role == UserRole.COLLECTOR.value:
        collector = principal.collector_profile()
        if collector_id is not None and collector_id != collector.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Collectors can only record collections under their own name.")
        return collector
    if collector_id is None:
        return None
    collector = db.get(Collector, collector_id)
    if collector is None or collector.cooperative_id != cooperative_id:
        raise field_error("collector_id", "Choose a collector from this cooperative.")
    if collector.status != "ACTIVE":
        raise field_error("collector_id", "This collector is inactive.")
    return collector


def resolve_cooler(db: Session, cooperative_id: UUID, cooler_id: Optional[UUID]) -> Optional[Cooler]:
    if cooler_id is None:
        return None
    cooler = db.get(Cooler, cooler_id)
    if cooler is None or cooler.cooperative_id != cooperative_id:
        raise field_error("cooler_id", "Choose a cooler from this cooperative.")
    if cooler.status != CoolerStatus.ACTIVE:
        raise field_error("cooler_id", "This cooler has been decommissioned.")
    return cooler


def resolve_centre(db: Session, cooperative_id: UUID, centre_id: Optional[UUID]) -> Optional[CollectionCentre]:
    if centre_id is None:
        return None
    centre = db.get(CollectionCentre, centre_id)
    if centre is None or centre.cooperative_id != cooperative_id:
        raise field_error("centre_id", "Choose a collection centre from this cooperative.")
    if centre.status != "ACTIVE":
        raise field_error("centre_id", "This collection centre is inactive.")
    return centre


def resolve_farmers(db: Session, cooperative_id: UUID, farmer_ids: list[UUID], *, allow_inactive: Iterable[UUID] = ()) -> dict[UUID, Farmer]:
    rows = {f.id: f for f in db.query(Farmer).filter(Farmer.id.in_(farmer_ids)).all()} if farmer_ids else {}
    allowed_inactive = set(allow_inactive)
    for index, farmer_id in enumerate(farmer_ids):
        farmer = rows.get(farmer_id)
        if farmer is None or farmer.cooperative_id != cooperative_id:
            raise field_error(f"allocations.{index}.farmer_id", "Choose a farmer from this cooperative.")
        if farmer.status != "ACTIVE" and farmer_id not in allowed_inactive:
            raise field_error(
                f"allocations.{index}.farmer_id", f"{farmer.full_name} is inactive. Reactivate them before recording milk.",
            )
    return rows


def check_allocation(captured, allocations: list[tuple[UUID, Decimal]]) -> Decimal:
    """Total allocated KG; refuses negative/zero lines, duplicates and over-allocation."""
    seen: set[UUID] = set()
    total = Decimal("0")
    for index, (farmer_id, amount) in enumerate(allocations):
        if amount <= 0:
            raise field_error(f"allocations.{index}.quantity_kg", "Allocate more than 0 KG.")
        if farmer_id in seen:
            raise field_error(f"allocations.{index}.farmer_id", "Each farmer can appear only once in a collection.")
        seen.add(farmer_id)
        total += amount
    if not allocations:
        raise field_error("allocations", "Allocate the milk to at least one farmer.")
    if total > kg(captured):
        raise field_error("allocations", f"The allocated weight ({total} KG) is more than the captured weight ({kg(captured)} KG).")
    return total


# ---------------- persistence ----------------

def _free_line_id(db: Session, wanted: Optional[UUID], cooperative_id: UUID) -> UUID:
    if wanted is None:
        return uuid4()
    existing = db.get(MilkCollection, wanted)
    return wanted if existing is None else uuid4()


def persist(
    db: Session, principal: Principal, *, cooperative: Cooperative, content: dict, weight_source: str,
    collector: Optional[Collector], cooler: Optional[Cooler], centre: Optional[CollectionCentre],
    origin: Optional[SyncOrigin] = None, batch_id: Optional[UUID] = None, supersedes: Optional[CollectionBatch] = None,
    factor: Optional[Decimal] = None, extra: Optional[dict] = None, allow_inactive_farmers: Iterable[UUID] = (),
) -> tuple[CollectionBatch, list[MilkCollection], dict[UUID, Farmer]]:
    """Validate and add (flush, no commit) a batch and its lines. `content` uses the BatchCreate field names."""
    allocations = [(a["farmer_id"], kg(a["quantity_kg"])) for a in content["allocations"]]
    total = check_allocation(content["captured_weight_kg"], allocations)
    farmers = resolve_farmers(db, cooperative.id, [f for f, _ in allocations], allow_inactive=allow_inactive_farmers)
    quality, reason = resolve_quality(
        db, content.get("quality_status"), content.get("rejection_reason"), content.get("temperature_c"),
        content.get("fat_percentage"),
    )
    factor = factor or density(db)
    now = datetime.datetime.utcnow()
    day = content.get("collection_date") or now.date()
    at = content.get("collection_time") or now.time().replace(microsecond=0)
    centre_id = (
        (centre.id if centre else None) or (cooler.centre_id if cooler and cooler.centre_id else None)
        or (collector.centre_id if collector else None)
    )
    extra = extra or {}
    batch = CollectionBatch(
        id=batch_id or uuid4(),
        reference=reference(db, CollectionBatch, "CB", day),
        cooperative_id=cooperative.id,
        centre_id=centre_id,
        cooler_id=cooler.id if cooler else None,
        collector_id=collector.id if collector else None,
        recorded_by=principal.user.id,
        device_id=origin.device_id if origin else None,
        client_recorded_at=origin.client_recorded_at if origin else None,
        status=BatchStatus.CONFIRMED,
        collection_date=day,
        collection_time=at,
        captured_weight_kg=kg(content["captured_weight_kg"]),
        allocated_weight_kg=total,
        tare_weight_kg=kg(content["tare_weight_kg"]) if content.get("tare_weight_kg") is not None else None,
        weight_source=weight_source,
        scale_name=extra.get("scale_name"),
        scale_identifier=extra.get("scale_identifier"),
        density_kg_per_litre=factor,
        temperature_c=content.get("temperature_c"),
        notes=content.get("notes"),
        started_at=extra.get("started_at"),
        captured_at=extra.get("captured_at"),
        confirmed_at=extra.get("confirmed_at") or now,
        send_receipts=bool(extra.get("send_receipts", True)),
        supersedes_batch_id=supersedes.id if supersedes else None,
    )
    db.add(batch)
    db.flush()  # the lines reference it
    line_ids = {a["farmer_id"]: a.get("id") for a in content["allocations"]}
    entered_litres = {a["farmer_id"]: a.get("quantity_litres") for a in content["allocations"]}
    lines = []
    for farmer_id, amount in allocations:
        farmer = farmers[farmer_id]
        line = MilkCollection(
            id=_free_line_id(db, line_ids.get(farmer_id), cooperative.id),
            reference=reference(db, MilkCollection, "MC", day),
            batch_id=batch.id,
            cooperative_id=cooperative.id,
            farmer_id=farmer.id,
            collector_id=batch.collector_id,
            cooler_id=batch.cooler_id,
            centre_id=centre_id or farmer.centre_id,
            collection_date=day,
            collection_time=at,
            quantity_kg=amount,
            quantity_litres=entered_litres.get(farmer_id) or litres_from_kg(amount, factor),
            fat_percentage=content.get("fat_percentage"),
            snf_percentage=content.get("snf_percentage"),
            temperature_c=content.get("temperature_c"),
            quality_status=quality,
            rejection_reason=reason,
            notes=content.get("notes"),
            recorded_by=principal.user.id,
            device_id=batch.device_id,
            client_recorded_at=batch.client_recorded_at,
            record_status=LineStatus.ACTIVE,
        )
        db.add(line)
        lines.append(line)
    db.flush()
    return batch, lines, farmers


def create(db: Session, principal: Principal, payload, origin: Optional[SyncOrigin] = None) -> tuple[CollectionBatch, list]:
    """Confirm a new batch (schemas.collections.BatchCreate). Commits. Returns (batch, receipt notifications)."""
    from services import receipts  # local: receipts imports this module

    cooperative = target_cooperative(db, principal, payload.cooperative_id)
    wanted_id = (origin.entity_id if origin else None) or payload.id
    if wanted_id is not None:
        existing = db.get(CollectionBatch, wanted_id)
        if existing is not None:
            if existing.cooperative_id != cooperative.id:
                wanted_id = None  # the id is taken elsewhere: the server allocates its own
            elif principal.role == UserRole.COLLECTOR.value and existing.collector_id != principal.collector_profile().id:
                # Never hand one collector's batch to another, even on an id collision.
                raise HTTPException(status.HTTP_409_CONFLICT, "This collection id is already in use. Start a new collection.")
            else:
                return existing, []  # a resend of a batch already confirmed: idempotent
    if payload.weight_source == WeightSource.SIMULATED and not accept_simulated():
        raise field_error("weight_source", "Simulated scale readings are not accepted on this server.")
    collector = resolve_collector(db, principal, cooperative.id, payload.collector_id)
    cooler = resolve_cooler(db, cooperative.id, payload.cooler_id or (collector.cooler_id if collector else None))
    centre = resolve_centre(db, cooperative.id, payload.centre_id)
    content = payload.model_dump()
    batch, lines, farmers = persist(
        db, principal, cooperative=cooperative, content=content, weight_source=payload.weight_source,
        collector=collector, cooler=cooler, centre=centre, origin=origin, batch_id=wanted_id,
        extra={
            "scale_name": payload.scale_name, "scale_identifier": payload.scale_identifier,
            "started_at": payload.started_at, "captured_at": payload.captured_at,
            "confirmed_at": payload.confirmed_at, "send_receipts": payload.send_receipts,
        },
    )
    audit.record(
        db, principal, "COLLECTION_CONFIRMED",
        target=(
            f"{batch.reference}: {batch.captured_weight_kg} KG captured ({_source_label(batch)}), "
            f"{batch.allocated_weight_kg} KG to {len(lines)} farmer(s)"
        ),
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=cooperative.id,
        new_values=audit_snapshot(batch, lines, farmers),
    )
    created = receipts.create_for_batch(db, cooperative, batch, lines, farmers)
    from services import inbox  # local import: inbox is optional for the confirmation itself

    if batch.weight_source == WeightSource.MANUAL and principal.role == UserRole.COLLECTOR.value:
        inbox.notify(
            db, cooperative_id=cooperative.id, roles=("COOP_ADMIN", "MANAGER"), category="COLLECTION",
            type="MANUAL_WEIGHT", severity="INFO", title=f"Manual weight entered for {batch.reference}",
            body=f"{batch.captured_weight_kg} KG typed in by {principal.user.full_name} instead of read from a scale.",
            entity_type="collection_batch", entity_id=batch.id, link=f"/collections?batch={batch.id}",
        )
    db.commit()
    db.refresh(batch)
    return batch, created


def accept_simulated() -> bool:
    import os

    return os.getenv("SCALE_ACCEPT_SIMULATED", "true").strip().lower() in {"1", "true", "yes", "on"}


def _source_label(batch: CollectionBatch) -> str:
    return {
        WeightSource.SCALE: f"scale {batch.scale_name or batch.scale_identifier or ''}".strip(),
        WeightSource.MANUAL: "manual entry",
        WeightSource.SIMULATED: "simulated scale",
        WeightSource.LITRES: "entered in litres",
    }.get(batch.weight_source, batch.weight_source)


def audit_snapshot(batch: CollectionBatch, lines: list[MilkCollection], farmers: dict) -> dict:
    return {
        "reference": batch.reference,
        "status": batch.status,
        "collection_date": iso(batch.collection_date),
        "cooler_id": str(batch.cooler_id) if batch.cooler_id else None,
        "centre_id": str(batch.centre_id) if batch.centre_id else None,
        "collector_id": str(batch.collector_id) if batch.collector_id else None,
        "captured_weight_kg": float(batch.captured_weight_kg),
        "allocated_weight_kg": float(batch.allocated_weight_kg),
        "weight_source": batch.weight_source,
        "scale": batch.scale_name or batch.scale_identifier,
        "allocations": [
            {"line": line.reference, "farmer": farmers[line.farmer_id].farmer_number if line.farmer_id in farmers else str(line.farmer_id),
             "quantity_kg": float(line.quantity_kg)}
            for line in lines
        ],
    }


def content_of(batch: CollectionBatch, lines: list[MilkCollection]) -> dict:
    """The batch as correctable content (the shape of BatchCorrectionProposal), JSON-safe."""
    first = lines[0] if lines else None
    return {
        "cooler_id": str(batch.cooler_id) if batch.cooler_id else None,
        "centre_id": str(batch.centre_id) if batch.centre_id else None,
        "collection_date": iso(batch.collection_date),
        "collection_time": batch.collection_time.strftime("%H:%M:%S") if batch.collection_time else None,
        "captured_weight_kg": float(batch.captured_weight_kg),
        "tare_weight_kg": num(batch.tare_weight_kg),
        "temperature_c": num(batch.temperature_c),
        "fat_percentage": num(first.fat_percentage) if first else None,
        "snf_percentage": num(first.snf_percentage) if first else None,
        "quality_status": first.quality_status if first else None,
        "rejection_reason": first.rejection_reason if first else None,
        "notes": batch.notes,
        "allocations": [{"farmer_id": str(line.farmer_id), "quantity_kg": float(line.quantity_kg)} for line in lines],
    }


# ---------------- reading ----------------

def scope(query, principal: Principal, cooperative_id: Optional[UUID] = None):
    """Staff: their cooperative; a collector: batches they recorded; a farmer: batches with a line of theirs."""
    scoped = cooperative_scope(principal, cooperative_id)
    if scoped is not None:
        query = query.filter(CollectionBatch.cooperative_id == scoped)
    if principal.role == UserRole.COLLECTOR.value:
        query = query.filter(CollectionBatch.collector_id == principal.collector_profile().id)
    elif principal.role == UserRole.FARMER.value:
        mine = select(MilkCollection.batch_id).where(MilkCollection.farmer_id == principal.farmer_profile().id)
        query = query.filter(CollectionBatch.id.in_(mine))
    return query


def lines_for(db: Session, batch_ids: list[UUID]) -> dict[UUID, list[tuple[MilkCollection, Farmer]]]:
    out: dict[UUID, list] = {bid: [] for bid in batch_ids}
    if not batch_ids:
        return out
    rows = (
        db.query(MilkCollection, Farmer).join(Farmer, Farmer.id == MilkCollection.farmer_id)
        .filter(MilkCollection.batch_id.in_(batch_ids))
        .order_by(MilkCollection.reference).all()
    )
    for line, farmer in rows:
        out.setdefault(line.batch_id, []).append((line, farmer))
    return out


def receipts_for(db: Session, line_ids: list[UUID]) -> dict[UUID, Notification]:
    if not line_ids:
        return {}
    rows = db.query(Notification).filter(Notification.collection_id.in_(line_ids)).order_by(Notification.created_at).all()
    return {n.collection_id: n for n in rows}


def batch_json(db: Session, batch: CollectionBatch, *, lines=None, names: Optional[dict] = None, receipts=None,
               pending_request: Optional[dict] = None) -> dict:
    lines = lines if lines is not None else lines_for(db, [batch.id]).get(batch.id, [])
    receipts = receipts if receipts is not None else receipts_for(db, [line.id for line, _ in lines])
    names = names if names is not None else names_for(db, [batch])
    n = names.get(batch.id, {})
    return {
        "id": str(batch.id),
        "reference": batch.reference,
        "cooperative_id": str(batch.cooperative_id),
        "cooperative_name": n.get("cooperative_name"),
        "centre_id": str(batch.centre_id) if batch.centre_id else None,
        "centre_name": n.get("centre_name"),
        "cooler_id": str(batch.cooler_id) if batch.cooler_id else None,
        "cooler_name": n.get("cooler_name"),
        "cooler_code": n.get("cooler_code"),
        "collector_id": str(batch.collector_id) if batch.collector_id else None,
        "collector_name": n.get("collector_name"),
        "collector_number": n.get("collector_number"),
        "recorded_by": str(batch.recorded_by) if batch.recorded_by else None,
        "recorded_by_name": n.get("recorded_by_name"),
        "status": batch.status,
        "collection_date": iso(batch.collection_date),
        "collection_time": batch.collection_time.strftime("%H:%M") if batch.collection_time else None,
        "captured_weight_kg": num(batch.captured_weight_kg),
        "allocated_weight_kg": num(batch.allocated_weight_kg),
        "remaining_weight_kg": num(batch.captured_weight_kg - batch.allocated_weight_kg),
        "tare_weight_kg": num(batch.tare_weight_kg),
        "weight_source": batch.weight_source,
        "scale_name": batch.scale_name,
        "scale_identifier": batch.scale_identifier,
        "density_kg_per_litre": num(batch.density_kg_per_litre),
        "temperature_c": num(batch.temperature_c),
        "notes": batch.notes,
        "started_at": iso(batch.started_at),
        "captured_at": iso(batch.captured_at),
        "confirmed_at": iso(batch.confirmed_at),
        "client_recorded_at": iso(batch.client_recorded_at),
        "device_id": str(batch.device_id) if batch.device_id else None,
        "send_receipts": bool(batch.send_receipts),
        "supersedes_batch_id": str(batch.supersedes_batch_id) if batch.supersedes_batch_id else None,
        "superseded_by_batch_id": str(batch.superseded_by_batch_id) if batch.superseded_by_batch_id else None,
        "farmer_count": len(lines),
        "lines": [
            {
                "id": str(line.id),
                "reference": line.reference,
                "farmer_id": str(farmer.id),
                "farmer_name": farmer.full_name,
                "farmer_number": farmer.farmer_number,
                "quantity_kg": num(line.quantity_kg),
                "quantity_litres": num(line.quantity_litres),
                "quality_status": line.quality_status,
                "rejection_reason": line.rejection_reason,
                "fat_percentage": num(line.fat_percentage),
                "snf_percentage": num(line.snf_percentage),
                "record_status": line.record_status,
                "receipt_status": receipts[line.id].status if line.id in receipts else None,
                "receipt_error": receipts[line.id].error if line.id in receipts else None,
            }
            for line, farmer in lines
        ],
        "pending_request": pending_request,
        "sync_version": batch.sync_version,
        "created_at": iso(batch.created_at),
        "updated_at": iso(batch.updated_at),
    }


def names_for(db: Session, batches: list[CollectionBatch]) -> dict[UUID, dict]:
    """Display names for a page of batches, with one query per related table."""
    if not batches:
        return {}

    def lookup(model, ids, *cols):
        ids = {i for i in ids if i}
        if not ids:
            return {}
        return {row[0]: row[1:] for row in db.query(model.id, *cols).filter(model.id.in_(ids)).all()}

    coops = lookup(Cooperative, [b.cooperative_id for b in batches], Cooperative.name)
    centres = lookup(CollectionCentre, [b.centre_id for b in batches], CollectionCentre.name)
    coolers = lookup(Cooler, [b.cooler_id for b in batches], Cooler.name, Cooler.code)
    users = lookup(User, [b.recorded_by for b in batches], User.full_name)
    collector_ids = {b.collector_id for b in batches if b.collector_id}
    collectors = {
        c.id: (u.full_name, c.collector_number)
        for c, u in db.query(Collector, User).join(User, User.id == Collector.user_id).filter(Collector.id.in_(collector_ids))
    } if collector_ids else {}
    out = {}
    for b in batches:
        out[b.id] = {
            "cooperative_name": (coops.get(b.cooperative_id) or (None,))[0],
            "centre_name": (centres.get(b.centre_id) or (None,))[0],
            "cooler_name": (coolers.get(b.cooler_id) or (None, None))[0],
            "cooler_code": (coolers.get(b.cooler_id) or (None, None))[1],
            "collector_name": (collectors.get(b.collector_id) or (None, None))[0],
            "collector_number": (collectors.get(b.collector_id) or (None, None))[1],
            "recorded_by_name": (users.get(b.recorded_by) or (None,))[0],
        }
    return out


def serialize_many(db: Session, batches: list[CollectionBatch]) -> list[dict]:
    from models.operations import CollectionCorrectionRequest, RequestStatus

    ids = [b.id for b in batches]
    lines = lines_for(db, ids)
    receipts = receipts_for(db, [line.id for rows in lines.values() for line, _ in rows])
    names = names_for(db, batches)
    pending = {
        r.batch_id: r for r in db.query(CollectionCorrectionRequest).filter(
            CollectionCorrectionRequest.batch_id.in_(ids), CollectionCorrectionRequest.status == RequestStatus.PENDING,
        ).all()
    } if ids else {}
    return [
        batch_json(
            db, b, lines=lines.get(b.id, []), names=names, receipts=receipts,
            pending_request={"id": str(pending[b.id].id), "type": pending[b.id].request_type} if b.id in pending else None,
        )
        for b in batches
    ]


def summarize(query) -> dict:
    effective = CollectionBatch.status.in_(BatchStatus.EFFECTIVE)

    count, captured, allocated = query.with_entities(
        func.coalesce(func.sum(case((effective, 1), else_=0)), 0),
        func.coalesce(func.sum(case((effective, CollectionBatch.captured_weight_kg), else_=0)), 0),
        func.coalesce(func.sum(case((effective, CollectionBatch.allocated_weight_kg), else_=0)), 0),
    ).order_by(None).one()
    return {
        "batches": int(count or 0),
        "captured_kg": num(captured) or 0.0,
        "allocated_kg": num(allocated) or 0.0,
        "unallocated_kg": round((num(captured) or 0.0) - (num(allocated) or 0.0), 2),
    }
