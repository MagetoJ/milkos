"""Milk collections for cooperative staff, collectors and farmers: /api/v1/collections.

What each caller sees is decided by services.collections.scope (from the database, never the request):
  COOP_ADMIN / MANAGER   their cooperative's collections; may record (and request corrections through
                         /api/v1/collection-batches/{id}/corrections - confirmed records are never edited)
  COLLECTOR              only collections recorded under their own profile; may record
  FARMER                 only their own deliveries; read-only
Superadmins use /api/v1/superadmin/collections instead.
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.access import Principal, ensure_same_cooperative, require_permission
from core.pagination import PageParams, apply_sort, page_params, paginate
from core.permissions import Permission
from core.utils import parse_uuid
from db import get_db
from models.admin import Cooler, CoolerStatus
from models.centre import CollectionCentre
from models.farmer import Farmer
from models.operations import Collector, MilkCollection
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CollectionCreate, CollectionUpdate
from services import collections, farmers

router = APIRouter(prefix="/api/v1/collections", tags=["Collections"])

SORTS = {
    "collection_date": MilkCollection.collection_date, "quantity_litres": MilkCollection.quantity_litres,
    "created_at": MilkCollection.created_at,
}
DEFAULT_ORDER = [MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc(), MilkCollection.id]


def _tenant(principal: Principal) -> Principal:
    if principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform administrators use /api/v1/superadmin/collections.")
    return principal


@router.get("")
def list_collections(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    farmer_id: Optional[str] = None,
    collector_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    quality_status: Optional[str] = Query(None, pattern="^(ACCEPTED|REJECTED|PENDING)$"),
    batch_id: Optional[str] = None,
    centre_id: Optional[str] = None,
    include_history: bool = Query(False, description="Also list superseded and reversed lines"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    # A cooperative_id other than the caller's own is refused (403) inside scope().
    query = collections.scope(
        collections.base_query(db), principal, parse_uuid(cooperative_id, "Cooperative") if cooperative_id else None
    )
    query = collections.apply_filters(
        query,
        farmer_id=parse_uuid(farmer_id, "Farmer") if farmer_id else None,
        collector_id=parse_uuid(collector_id, "Collector") if collector_id else None,
        cooler_id=parse_uuid(cooler_id, "Cooler") if cooler_id else None,
        date_from=date_from, date_to=date_to, quality_status=quality_status, search=search,
        batch_id=parse_uuid(batch_id, "Collection") if batch_id else None,
        centre_id=parse_uuid(centre_id, "Centre") if centre_id else None,
        include_history=include_history or bool(batch_id),
    )
    result = paginate(apply_sort(query, params.sort, SORTS, DEFAULT_ORDER), params, collections.collection_json)
    result["summary"] = collections.summarize(query)
    result["role"] = principal.role
    result["can_record"] = principal.can(Permission.COLLECTION_CREATE)
    result["can_request_correction"] = principal.can(Permission.CORRECTION_REQUEST)
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def record_collection(
    payload: CollectionCreate,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    collection = collections.create(db, principal, payload)
    return collections.collection_json(collections.load_row(db, collection.id))


@router.get("/options")
def recording_options(
    search: Optional[str] = Query(None, max_length=100),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
):
    """Active farmers (searchable), coolers, centres and collectors to choose from when recording milk."""
    _tenant(principal)
    coop_id = principal.cooperative_id
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
             "farmer_number": f.farmer_number, "phone": f.phone, "centre_id": str(f.centre_id) if f.centre_id else None}
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


@router.get("/{collection_id}")
def get_collection(
    collection_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    row = (
        collections.scope(collections.base_query(db), principal)
        .filter(MilkCollection.id == parse_uuid(collection_id, "Collection"))
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    return collections.collection_json(row)


@router.patch("/{collection_id}")
def complete_lab_result(
    collection_id: str,
    payload: CollectionUpdate,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_UPDATE)),
    db: Session = Depends(get_db),
):
    """Confirmed collections are immutable. The only accepted change is completing a PENDING lab test
    (quality_status ACCEPTED/REJECTED with fat, SNF or a rejection reason); anything else is 409 and needs a
    correction request (POST /api/v1/collection-batches/{batch_id}/corrections)."""
    _tenant(principal)
    collection = ensure_same_cooperative(
        principal, db.get(MilkCollection, parse_uuid(collection_id, "Collection")), "Collection"
    )
    lab = collections.lab_result_from_update(payload.model_dump(exclude_unset=True))
    if lab is None:
        raise HTTPException(status.HTTP_409_CONFLICT, collections.IMMUTABLE)
    collection = collections.record_lab_result(db, principal, collection, lab)
    return collections.collection_json(collections.load_row(db, collection.id))
