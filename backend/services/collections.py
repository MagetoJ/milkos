"""Milk collections: recording, correcting and querying, scoped to what the caller may see."""
import datetime
import secrets
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, aliased

from core.access import Principal, cooperative_scope
from core.utils import changed, field_error, iso, like, num, snapshot
from models.admin import Cooler, CoolerStatus
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector, MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CollectionCreate, CollectionUpdate
from services import audit, settings
from services.common import SyncOrigin, target_cooperative

AUDITED = (
    "quantity_litres", "fat_percentage", "snf_percentage", "temperature_c", "quality_status",
    "rejection_reason", "cooler_id", "notes",
)

CollectorUser = aliased(User, name="collector_user")


def base_query(db: Session):
    """(collection, farmer, cooperative, collector, collector_user, cooler) rows."""
    return (
        db.query(MilkCollection, Farmer, Cooperative, Collector, CollectorUser, Cooler)
        .join(Farmer, Farmer.id == MilkCollection.farmer_id)
        .join(Cooperative, Cooperative.id == MilkCollection.cooperative_id)
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
    quality_status=None, min_litres=None, max_litres=None, search=None,
):
    if farmer_id:
        query = query.filter(MilkCollection.farmer_id == farmer_id)
    if collector_id:
        query = query.filter(MilkCollection.collector_id == collector_id)
    if cooler_id:
        query = query.filter(MilkCollection.cooler_id == cooler_id)
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
            Farmer.first_name.ilike(pattern, escape="\\"),
            Farmer.last_name.ilike(pattern, escape="\\"),
            Farmer.farmer_number.ilike(pattern, escape="\\"),
        ))
    return query


def summarize(query) -> dict:
    """Totals for the filtered set, computed in the database."""
    accepted = MilkCollection.quality_status == QualityStatus.ACCEPTED
    row = query.with_entities(
        func.count(MilkCollection.id),
        func.coalesce(func.sum(case((accepted, MilkCollection.quantity_litres), else_=0)), 0),
        func.coalesce(func.sum(case((MilkCollection.quality_status == QualityStatus.REJECTED, 1), else_=0)), 0),
        func.coalesce(func.sum(case((MilkCollection.quality_status == QualityStatus.REJECTED, MilkCollection.quantity_litres), else_=0)), 0),
        func.avg(case((and_(accepted, MilkCollection.fat_percentage.isnot(None)), MilkCollection.fat_percentage))),
    ).order_by(None).one()
    count, litres, rejected, rejected_litres, avg_fat = row
    return {
        "collections": count or 0,
        "accepted_litres": num(litres) or 0.0,
        "rejected_collections": int(rejected or 0),
        "rejected_litres": num(rejected_litres) or 0.0,
        "average_fat_percentage": round(float(avg_fat), 2) if avg_fat is not None else None,
    }


def collection_json(row) -> dict:
    collection, farmer, cooperative, collector, collector_user, cooler = row
    return {
        "id": str(collection.id),
        "reference": collection.reference,
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


def _reference(db: Session, day: datetime.date) -> str:
    for _ in range(10):
        ref = f"MC-{day:%y%m%d}-{secrets.token_hex(3).upper()}"
        if not db.query(MilkCollection.id).filter(MilkCollection.reference == ref).first():
            return ref
    return f"MC-{day:%y%m%d}-{secrets.token_hex(6).upper()}"


def _automatic_quality(db: Session, temperature: Optional[float], fat: Optional[float]) -> Optional[str]:
    """Reason to reject under the platform's quality thresholds, if any applies."""
    max_temp = settings.get(db, "collection.max_temperature_c")
    min_fat = settings.get(db, "collection.min_fat_percentage")
    if max_temp is not None and temperature is not None and temperature > max_temp:
        return f"Temperature {temperature:g}°C is above the {max_temp:g}°C limit."
    if min_fat is not None and fat is not None and fat < min_fat:
        return f"Butterfat {fat:g}% is below the {min_fat:g}% minimum."
    return None


def _check_quality(quality_status: str, reason: Optional[str]) -> None:
    if quality_status == QualityStatus.REJECTED and not (reason and len(reason.strip()) >= 3):
        raise field_error("rejection_reason", "Say why this milk was rejected.")


def create(
    db: Session, principal: Principal, payload: CollectionCreate, origin: Optional[SyncOrigin] = None,
) -> MilkCollection:
    cooperative = target_cooperative(db, principal, payload.cooperative_id)

    farmer = db.get(Farmer, payload.farmer_id)
    if farmer is None or farmer.cooperative_id != cooperative.id:
        raise field_error("farmer_id", "Choose a farmer from this cooperative.")
    if farmer.status != "ACTIVE":
        raise field_error("farmer_id", "This farmer is inactive. Reactivate them before recording milk.")

    # A collector always records under their own profile; staff may name any active collector.
    if principal.role == UserRole.COLLECTOR.value:
        collector = principal.collector_profile()
        if payload.collector_id is not None and payload.collector_id != collector.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Collectors can only record collections under their own name.")
    elif payload.collector_id is not None:
        collector = db.get(Collector, payload.collector_id)
        if collector is None or collector.cooperative_id != cooperative.id:
            raise field_error("collector_id", "Choose a collector from this cooperative.")
        if collector.status != "ACTIVE":
            raise field_error("collector_id", "This collector is inactive.")
    else:
        collector = None

    cooler_id = payload.cooler_id or (collector.cooler_id if collector else None)
    cooler = db.get(Cooler, cooler_id) if cooler_id else None
    if cooler_id and (cooler is None or cooler.cooperative_id != cooperative.id):
        raise field_error("cooler_id", "Choose a cooler from this cooperative.")
    if cooler is not None and cooler.status != CoolerStatus.ACTIVE:
        raise field_error("cooler_id", "This cooler has been decommissioned.")

    quality = payload.quality_status
    reason = payload.rejection_reason
    if quality is None:
        auto = _automatic_quality(db, payload.temperature_c, payload.fat_percentage)
        quality, reason = (QualityStatus.REJECTED, auto) if auto else (QualityStatus.ACCEPTED, None)
    _check_quality(quality, reason)

    now = datetime.datetime.utcnow()
    day = payload.collection_date or now.date()
    collection = MilkCollection(
        **(origin.id_kwargs() if origin else {}),
        device_id=origin.device_id if origin else None,
        client_recorded_at=origin.client_recorded_at if origin else None,
        reference=_reference(db, day),
        cooperative_id=cooperative.id,
        farmer_id=farmer.id,
        collector_id=collector.id if collector else None,
        cooler_id=cooler.id if cooler else None,
        centre_id=(cooler.centre_id if cooler and cooler.centre_id else None) or (collector.centre_id if collector else None) or farmer.centre_id,
        collection_date=day,
        collection_time=payload.collection_time or now.time().replace(microsecond=0),
        quantity_litres=payload.quantity_litres,
        fat_percentage=payload.fat_percentage,
        snf_percentage=payload.snf_percentage,
        temperature_c=payload.temperature_c,
        quality_status=quality,
        rejection_reason=reason if quality == QualityStatus.REJECTED else None,
        notes=payload.notes,
        recorded_by=principal.user.id,
    )
    db.add(collection)
    db.flush()
    audit.record(
        db, principal, "COLLECTION_RECORDED",
        target=f"{collection.reference}: {payload.quantity_litres:g} L from {farmer.full_name} ({farmer.farmer_number})",
        entity_type="collection", entity_id=collection.id, cooperative_id=cooperative.id,
        new_values=snapshot(collection, AUDITED),
    )
    db.commit()
    db.refresh(collection)
    return collection


def update(db: Session, principal: Principal, collection: MilkCollection, payload: CollectionUpdate) -> MilkCollection:
    data = payload.model_dump(exclude_unset=True)
    for name in ("quantity_litres", "quality_status"):
        if name in data and data[name] is None:
            raise field_error(name, "This field can't be empty.")
    if data.get("cooler_id") is not None:
        cooler = db.get(Cooler, data["cooler_id"])
        if cooler is None or cooler.cooperative_id != collection.cooperative_id:
            raise field_error("cooler_id", "Choose a cooler from this cooperative.")

    before = snapshot(collection, AUDITED)
    for name, value in data.items():
        setattr(collection, name, value)
    if collection.quality_status != QualityStatus.REJECTED:
        collection.rejection_reason = None
    _check_quality(collection.quality_status, collection.rejection_reason)

    old, new = changed(before, snapshot(collection, AUDITED))
    if new:
        audit.record(
            db, principal, "COLLECTION_UPDATED", target=f"{collection.reference}",
            entity_type="collection", entity_id=collection.id, cooperative_id=collection.cooperative_id,
            old_values=old, new_values=new,
        )
        db.commit()
    db.refresh(collection)
    return collection
