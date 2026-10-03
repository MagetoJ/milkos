import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, page_params, paginate
from core.utils import parse_uuid
from db import get_db
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import MilkCollection
from services import collections

router = APIRouter(prefix="/collections")

SORTS = {
    "collection_date": MilkCollection.collection_date, "quantity_litres": MilkCollection.quantity_litres,
    "fat_percentage": MilkCollection.fat_percentage, "created_at": MilkCollection.created_at,
    "cooperative": Cooperative.name, "farmer": Farmer.last_name,
}
DEFAULT_ORDER = [MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc(), MilkCollection.id]


def filtered(
    db: Session, principal: Principal, *, cooperative_id=None, farmer_id=None, collector_id=None, cooler_id=None,
    date_from=None, date_to=None, quality_status=None, min_litres=None, max_litres=None, search=None,
):
    query = collections.scope(collections.base_query(db), principal, cooperative_id)
    return collections.apply_filters(
        query, farmer_id=farmer_id, collector_id=collector_id, cooler_id=cooler_id, date_from=date_from,
        date_to=date_to, quality_status=quality_status, min_litres=min_litres, max_litres=max_litres, search=search,
    )


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
    min_litres: Optional[float] = Query(None, ge=0),
    max_litres: Optional[float] = Query(None, ge=0),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    query = filtered(
        db, admin,
        cooperative_id=parse_uuid(cooperative_id, "Cooperative") if cooperative_id else None,
        farmer_id=parse_uuid(farmer_id, "Farmer") if farmer_id else None,
        collector_id=parse_uuid(collector_id, "Collector") if collector_id else None,
        cooler_id=parse_uuid(cooler_id, "Cooler") if cooler_id else None,
        date_from=date_from, date_to=date_to, quality_status=quality_status,
        min_litres=min_litres, max_litres=max_litres, search=search,
    )
    result = paginate(apply_sort(query, params.sort, SORTS, DEFAULT_ORDER), params, collections.collection_json)
    result["summary"] = collections.summarize(query)
    return result


@router.get("/{collection_id}")
def get_collection(collection_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    row = collections.load_row(db, parse_uuid(collection_id, "Collection"))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    return collections.collection_json(row)
