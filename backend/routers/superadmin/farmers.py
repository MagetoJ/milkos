from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, fetch_page, page_params, page_result
from core.utils import parse_uuid
from db import get_db
from models.admin import AuditLog
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import MilkCollection
from schemas.cooperative_module import FarmerCreate, FarmerUpdate
from schemas.platform import StatusChange
from services import audit, collections, farmers

router = APIRouter(prefix="/farmers")

SORTS = {
    "name": Farmer.last_name, "farmer_number": Farmer.farmer_number, "created_at": Farmer.created_at,
    "cooperative": Cooperative.name, "status": Farmer.status,
}


def _get(db: Session, farmer_id: str) -> Farmer:
    farmer = db.get(Farmer, parse_uuid(farmer_id, "Farmer"))
    if farmer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Farmer not found")
    return farmer


def _json(db: Session, farmer: Farmer) -> dict:
    centre = db.get(CollectionCentre, farmer.centre_id) if farmer.centre_id else None
    data = farmers.farmer_json(farmer, centre.name if centre else None, db.get(Cooperative, farmer.cooperative_id))
    data["stats"] = farmers.collection_stats(db, [farmer.id]).get(farmer.id) or {
        "total_litres": 0.0, "collections": 0, "last_collection": None,
    }
    return data


@router.get("")
def list_farmers(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    centre_id: Optional[str] = None,
    farmer_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = (
        db.query(Farmer, CollectionCentre.name, Cooperative)
        .join(Cooperative, Cooperative.id == Farmer.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Farmer.centre_id)
    )
    if cooperative_id:
        query = query.filter(Farmer.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if centre_id:
        query = query.filter(Farmer.centre_id == parse_uuid(centre_id, "Collection centre"))
    if farmer_status:
        query = query.filter(Farmer.status == farmer_status)
    query = farmers.search_filter(query, search)
    query = apply_sort(query, params.sort, SORTS, [Farmer.last_name, Farmer.first_name, Farmer.id])

    rows, total = fetch_page(query, params)
    stats = farmers.collection_stats(db, [f.id for f, _, _ in rows])
    empty = {"total_litres": 0.0, "collections": 0, "last_collection": None}
    items = [
        {**farmers.farmer_json(f, centre_name, coop), "stats": stats.get(f.id, empty)}
        for f, centre_name, coop in rows
    ]
    return page_result(items, total, params)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_farmer(payload: FarmerCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    farmer, _ = farmers.create(db, admin, payload)
    return _json(db, farmer)


@router.get("/{farmer_id}")
def get_farmer(farmer_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    farmer = _get(db, farmer_id)
    recent = (
        collections.scope(collections.base_query(db), admin)
        .filter(MilkCollection.farmer_id == farmer.id)
        .order_by(MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc())
        .limit(10)
        .all()
    )
    activity = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "farmer", AuditLog.entity_id == str(farmer.id))
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        **_json(db, farmer),
        "recent_collections": [collections.collection_json(row) for row in recent],
        "activity": [audit.entry_json(e) for e in activity],
        # Farmer milk payouts are not tracked by the platform yet; payout details are on the profile.
        "payments_supported": False,
    }


@router.put("/{farmer_id}")
def update_farmer(
    farmer_id: str, payload: FarmerUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _json(db, farmers.update(db, admin, _get(db, farmer_id), payload))


@router.patch("/{farmer_id}/status")
def change_farmer_status(
    farmer_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _json(db, farmers.update(db, admin, _get(db, farmer_id), FarmerUpdate(status=payload.status)))
