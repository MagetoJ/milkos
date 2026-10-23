"""Milk collections (allocation lines): recording, lab results and querying, scoped to what the caller may see.

Every line belongs to a collection batch (services/batches.py). Lines are never edited in place once
confirmed: the only change a line accepts is completing a PENDING lab test (record_lab_result). Corrections
and reversals go through services/corrections.py and leave the original line in place, marked SUPERSEDED or
REVERSED. Totals (summaries, dashboards, reports, payments) count only ACTIVE lines.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, aliased

from app.core.utils import field_error, iso, like, num, parse_uuid, snapshot
from app.core.validation import mask_phone_local
from app.domain.exceptions import Conflict, NotFound
from app.domain.schemas.auth import UserRole
from app.domain.schemas.collections import LabResult
from app.domain.schemas.platform import CollectionCreate
from app.infrastructure.db.models.admin import Cooler, CoolerStatus
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.operations import (
    CollectionBatch, Collector, LineStatus, MilkCollection, QualityStatus, WeightSource,
)
from app.infrastructure.db.models.user import User
from app.infrastructure.db.pagination import apply_sort, paginate
from app.services import audit, batches, farmers
from app.services.common import SyncOrigin, target_cooperative
from app.services.principal import Principal, cooperative_scope, own

LAB_FIELDS = ("quality_status", "fat_percentage", "snf_percentage", "rejection_reason")

CollectorUser = aliased(User, name="collector_user")

# The only lines that count in totals, dashboards, reports and payments.
EFFECTIVE = MilkCollection.record_status == LineStatus.ACTIVE
ACCEPTED_EFFECTIVE = and_(EFFECTIVE, MilkCollection.quality_status == QualityStatus.ACCEPTED)


def base_query(db: Session):
    """(collection, farmer, cooperative, collector, collector_user, cooler, batch) rows."""
    return (
        db.query(MilkCollection, Farmer, Cooperative, Collector, CollectorUser, Cooler, CollectionBatch)
        .join(Farmer, Farmer.id == MilkCollection.farmer_id)
        .join(Cooperative, Cooperative.id == MilkCollection.cooperative_id)
        .join(CollectionBatch, CollectionBatch.id == MilkCollection.batch_id)
        .outerjoin(Collector, Collector.id == MilkCollection.collector_id)
        .outerjoin(CollectorUser, CollectorUser.id == Collector.user_id)
        .outerjoin(Cooler, Cooler.id == MilkCollection.cooler_id)
    )


def scope(query, principal: Principal, cooperative_id: Optional[UUID] = None):
    """Limit to the caller's tenant: superadmin all (or one cooperative), staff their cooperative,
    a collector what they recorded, a farmer their own deliveries."""
    scoped_coop = cooperative_scope(principal, cooperative_id)
    if scoped_coop is not None:
        query = query.filter(MilkCollection.cooperative_id == scoped_coop)
    if principal.role == UserRole.COLLECTOR.value:
        query = query.filter(MilkCollection.collector_id == principal.collector_profile().id)
    elif principal.role == UserRole.FARMER.value:
        query = query.filter(MilkCollection.farmer_id == principal.farmer_profile().id)
    return query


def apply_filters(
    query, *, farmer_id=None, collector_id=None, cooler_id=None, date_from=None, date_to=None,
    quality_status=None, min_litres=None, max_litres=None, search=None, batch_id=None, include_history=True,
    centre_id=None,
):
    if not include_history:
        query = query.filter(EFFECTIVE)
    if batch_id:
        query = query.filter(MilkCollection.batch_id == batch_id)
    if farmer_id:
        query = query.filter(MilkCollection.farmer_id == farmer_id)
    if collector_id:
        query = query.filter(MilkCollection.collector_id == collector_id)
    if cooler_id:
        query = query.filter(MilkCollection.cooler_id == cooler_id)
    if centre_id:
        query = query.filter(MilkCollection.centre_id == centre_id)
    if date_from:
        query = query.filter(MilkCollection.collection_date >= date_from)
    if date_to:
        query = query.filter(MilkCollection.collection_date <= date_to)
    if quality_status:
        query = query.filter(MilkCollection.quality_status == quality_status)
    if min_litres is not None:
        query = query.filter(MilkCollection.quantity_litres >= min_litres)
    if max_litres is not None:
        query = query.filter(MilkCollection.quantity_litres <= max_litres)
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            MilkCollection.reference.ilike(pattern, escape="\\"),
            CollectionBatch.reference.ilike(pattern, escape="\\"),
            Farmer.first_name.ilike(pattern, escape="\\"),
            Farmer.last_name.ilike(pattern, escape="\\"),
            Farmer.farmer_number.ilike(pattern, escape="\\"),
        ))
    return query


def summarize(query) -> dict:
    """Totals for the filtered set, computed in the database (superseded and reversed lines excluded)."""
    rejected = and_(EFFECTIVE, MilkCollection.quality_status == QualityStatus.REJECTED)
    row = query.with_entities(
        func.coalesce(func.sum(case((EFFECTIVE, 1), else_=0)), 0),
        func.coalesce(func.sum(case((ACCEPTED_EFFECTIVE, MilkCollection.quantity_litres), else_=0)), 0),
        func.coalesce(func.sum(case((rejected, 1), else_=0)), 0),
        func.coalesce(func.sum(case((rejected, MilkCollection.quantity_litres), else_=0)), 0),
        func.avg(case((and_(ACCEPTED_EFFECTIVE, MilkCollection.fat_percentage.isnot(None)), MilkCollection.fat_percentage))),
        func.coalesce(func.sum(case((ACCEPTED_EFFECTIVE, MilkCollection.quantity_kg), else_=0)), 0),
    ).order_by(None).one()
    count, litres, rejected_n, rejected_litres, avg_fat, accepted_kg = row
    return {
        "collections": int(count or 0),
        "accepted_litres": num(litres) or 0.0,
        "accepted_kg": num(accepted_kg) or 0.0,
        "rejected_collections": int(rejected_n or 0),
        "rejected_litres": num(rejected_litres) or 0.0,
        "average_fat_percentage": round(float(avg_fat), 2) if avg_fat is not None else None,
    }


def collection_json(row) -> dict:
    collection, farmer, cooperative, collector, collector_user, cooler, batch = row
    return {
        "id": str(collection.id),
        "reference": collection.reference,
        "batch_id": str(batch.id),
        "batch_reference": batch.reference,
        "batch_status": batch.status,
        "weight_source": batch.weight_source,
        "record_status": collection.record_status,
        "cooperative_id": str(collection.cooperative_id),
        "cooperative_name": cooperative.name,
        "cooperative_code": cooperative.code,
        "farmer_id": str(farmer.id),
        "farmer_name": farmer.full_name,
        "farmer_number": farmer.farmer_number,
        "collector_id": str(collector.id) if collector else None,
        "collector_name": collector_user.full_name if collector_user else None,
        "collector_number": collector.collector_number if collector else None,
        "cooler_id": str(cooler.id) if cooler else None,
        "cooler_name": cooler.name if cooler else None,
        "cooler_code": cooler.code if cooler else None,
        "collection_date": iso(collection.collection_date),
        "collection_time": collection.collection_time.strftime("%H:%M") if collection.collection_time else None,
        "quantity_kg": num(collection.quantity_kg),
        "quantity_litres": num(collection.quantity_litres),
        "fat_percentage": num(collection.fat_percentage),
        "snf_percentage": num(collection.snf_percentage),
        "temperature_c": num(collection.temperature_c),
        "quality_status": collection.quality_status,
        "rejection_reason": collection.rejection_reason,
        "notes": collection.notes,
        "recorded_by": str(collection.recorded_by) if collection.recorded_by else None,
        "centre_id": str(collection.centre_id) if collection.centre_id else None,
        "device_id": str(collection.device_id) if collection.device_id else None,
        "client_recorded_at": iso(collection.client_recorded_at),
        "sync_version": collection.sync_version,
        "created_at": iso(collection.created_at),
        "updated_at": iso(collection.updated_at),
    }


def load_row(db: Session, collection_id: UUID):
    return base_query(db).filter(MilkCollection.id == collection_id).first()


def create(
    db: Session, principal: Principal, payload: CollectionCreate, origin: Optional[SyncOrigin] = None,
) -> MilkCollection:
    """A single farmer's delivery entered in litres (the original recording form and API).

    Recorded as a one-line batch: KG is derived from the litres with the platform density, and the batch is
    flagged weight_source = LITRES so the figure is never mistaken for a scale reading.
    """
    cooperative = target_cooperative(db, principal, payload.cooperative_id)
    if origin and origin.entity_id is not None:
        existing = db.get(MilkCollection, origin.entity_id)
        if existing is not None and existing.cooperative_id == cooperative.id:
            return existing
    farmer = db.get(Farmer, payload.farmer_id)
    if farmer is None or farmer.cooperative_id != cooperative.id:
        raise field_error("farmer_id", "Choose a farmer from this cooperative.")
    if farmer.status != "ACTIVE":
        raise field_error("farmer_id", "This farmer is inactive. Reactivate them before recording milk.")
    collector = batches.resolve_collector(db, principal, cooperative.id, payload.collector_id)
    cooler = batches.resolve_cooler(db, cooperative.id, payload.cooler_id or (collector.cooler_id if collector else None))

    factor = batches.density(db)
    weight = batches.kg(batches.kg(payload.quantity_litres) * factor)
    content = {
        "collection_date": payload.collection_date, "collection_time": payload.collection_time,
        "captured_weight_kg": weight, "temperature_c": payload.temperature_c,
        "fat_percentage": payload.fat_percentage, "snf_percentage": payload.snf_percentage,
        "quality_status": payload.quality_status, "rejection_reason": payload.rejection_reason, "notes": payload.notes,
        "allocations": [{
            "id": origin.entity_id if origin else None, "farmer_id": farmer.id, "quantity_kg": weight,
            "quantity_litres": payload.quantity_litres,  # kept exactly as entered
        }],
    }
    batch, lines, farmers = batches.persist(
        db, principal, cooperative=cooperative, content=content, weight_source=WeightSource.LITRES,
        collector=collector, cooler=cooler, centre=None, origin=origin, factor=factor,
        extra={"send_receipts": False},
    )
    line = lines[0]
    audit.record(
        db, principal, "COLLECTION_RECORDED",
        target=f"{line.reference}: {payload.quantity_litres:g} L from {farmer.full_name} ({farmer.farmer_number})",
        entity_type="collection", entity_id=line.id, cooperative_id=cooperative.id,
        new_values={**snapshot(line, ("quantity_litres", "quantity_kg", "fat_percentage", "snf_percentage",
                                      "temperature_c", "quality_status", "rejection_reason", "cooler_id", "notes")),
                    "batch": batch.reference},
    )
    db.commit()
    db.refresh(line)
    return line


IMMUTABLE = "Confirmed collections can't be edited. Request a correction (or a reversal) instead."


def record_lab_result(db: Session, principal: Principal, collection: MilkCollection, payload: LabResult) -> MilkCollection:
    """Complete a PENDING lab test. Anything else on a confirmed line is refused (409)."""
    if collection.record_status != LineStatus.ACTIVE:
        raise Conflict("This collection was corrected or reversed and can't change.")
    if collection.quality_status != QualityStatus.PENDING:
        raise Conflict(IMMUTABLE)
    if payload.quality_status == QualityStatus.REJECTED and not (payload.rejection_reason and len(payload.rejection_reason) >= 3):
        raise field_error("rejection_reason", "Say why this milk was rejected.")
    before = snapshot(collection, LAB_FIELDS)
    collection.quality_status = payload.quality_status
    collection.rejection_reason = payload.rejection_reason if payload.quality_status == QualityStatus.REJECTED else None
    if payload.fat_percentage is not None:
        collection.fat_percentage = payload.fat_percentage
    if payload.snf_percentage is not None:
        collection.snf_percentage = payload.snf_percentage
    audit.record(
        db, principal, "COLLECTION_LAB_RESULT_RECORDED", target=f"{collection.reference}: {payload.quality_status}",
        entity_type="collection", entity_id=collection.id, cooperative_id=collection.cooperative_id,
        old_values=before, new_values=snapshot(collection, LAB_FIELDS),
    )
    db.commit()
    db.refresh(collection)
    return collection


def lab_result_from_update(data: dict) -> Optional[LabResult]:
    """An old-style PATCH body that only completes a lab test, as a LabResult (None if it changes anything else)."""
    if not data or set(data) - set(LAB_FIELDS) or data.get("quality_status") not in ("ACCEPTED", "REJECTED"):
        return None
    return LabResult(**data)


SORTS = {
    "collection_date": MilkCollection.collection_date, "quantity_litres": MilkCollection.quantity_litres,
    "created_at": MilkCollection.created_at,
}
# Platform staff may also sort by cooperative and farmer.
PLATFORM_SORTS = {
    **SORTS, "fat_percentage": MilkCollection.fat_percentage, "cooperative": Cooperative.name, "farmer": Farmer.last_name,
}
DEFAULT_ORDER = [MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc(), MilkCollection.id]


def list_page(db: Session, principal: Principal, cooperative_id: Optional[UUID], filters: dict, params,
              sorts: Optional[dict] = None) -> dict:
    """One page of the collections the caller may see. A cooperative_id other than their own is refused (403)."""
    query = apply_filters(scope(base_query(db), principal, cooperative_id), **filters)
    result = paginate(apply_sort(query, params.sort, sorts or SORTS, DEFAULT_ORDER), params, collection_json)
    result["summary"] = summarize(query)
    return result


def get_scoped(db: Session, principal: Principal, raw_id: str) -> dict:
    row = scope(base_query(db), principal).filter(MilkCollection.id == parse_uuid(raw_id, "Collection")).first()
    if row is None:
        raise NotFound("Collection")
    return collection_json(row)


def get_any(db: Session, raw_id: str) -> dict:
    """Any cooperative's collection line (platform staff)."""
    row = load_row(db, parse_uuid(raw_id, "Collection"))
    if row is None:
        raise NotFound("Collection")
    return collection_json(row)


def complete_lab_result(db: Session, principal: Principal, raw_id: str, changes: dict) -> dict:
    """The only change a confirmed line accepts: completing a PENDING lab test. Anything else is 409."""
    collection = own(db, principal, MilkCollection, raw_id, "Collection")
    lab = lab_result_from_update(changes)
    if lab is None:
        raise Conflict(IMMUTABLE)
    collection = record_lab_result(db, principal, collection, lab)
    return collection_json(load_row(db, collection.id))


def recording_options(db: Session, principal: Principal, search: Optional[str]) -> dict:
    """Active farmers (searchable), coolers, centres and collectors to choose from when recording milk."""
    coop_id = principal.cooperative_id
    staff_view = principal.role in (UserRole.COOP_ADMIN.value, UserRole.MANAGER.value)
    farmer_rows = (
        farmers.search_filter(db.query(Farmer).filter(Farmer.cooperative_id == coop_id, Farmer.status == "ACTIVE"), search)
        .order_by(Farmer.last_name, Farmer.first_name)
        .limit(25)
        .all()
    )
    cooler_rows = (
        db.query(Cooler, CollectionCentre.name).outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id)
        .filter(Cooler.cooperative_id == coop_id, Cooler.status == CoolerStatus.ACTIVE)
        .order_by(Cooler.code).all()
    )
    centre_rows = (
        db.query(CollectionCentre).filter(CollectionCentre.cooperative_id == coop_id, CollectionCentre.status == "ACTIVE")
        .order_by(CollectionCentre.name).all()
    )
    data = {
        "farmers": [
            {"id": str(f.id), "label": f"{f.full_name} ({f.farmer_number})", "full_name": f.full_name,
             "farmer_number": f.farmer_number,
             # Staff see the number; collectors get only enough of it to tell farmers apart.
             **({"phone": f.phone} if staff_view else {}), "phone_masked": mask_phone_local(f.phone),
             "centre_id": str(f.centre_id) if f.centre_id else None}
            for f in farmer_rows
        ],
        "coolers": [
            {"id": str(c.id), "label": f"{c.name} ({c.code})", "is_operational": bool(c.is_operational),
             "name": c.name, "code": c.code, "centre_id": str(c.centre_id) if c.centre_id else None, "centre_name": centre,
             "scale_device_id": c.scale_device_id, "current_volume_litres": float(c.current_volume_litres) if c.current_volume_litres is not None else None,
             "capacity_litres": float(c.capacity_litres) if c.capacity_litres is not None else None,
             "last_temperature_c": float(c.last_temperature_c) if c.last_temperature_c is not None else None}
            for c, centre in cooler_rows
        ],
        "centres": [{"id": str(c.id), "label": f"{c.name} ({c.code})", "name": c.name} for c in centre_rows],
        "collectors": [],
    }
    if principal.role == UserRole.COLLECTOR.value:
        mine = principal.collector_profile()
        data["default_cooler_id"] = str(mine.cooler_id) if mine.cooler_id else None
    else:
        data["collectors"] = [
            {"id": str(c.id), "label": f"{u.full_name} ({c.collector_number})"}
            for c, u in db.query(Collector, User).join(User, User.id == Collector.user_id)
            .filter(Collector.cooperative_id == coop_id, Collector.status == "ACTIVE").order_by(User.full_name)
        ]
    return data
