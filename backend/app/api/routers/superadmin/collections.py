import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.infrastructure.db.pagination import PageParams
from app.services import collections
from app.services.principal import Principal

router = APIRouter(prefix="/collections")


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
    filters = dict(
        farmer_id=optional_uuid(farmer_id, "Farmer"), collector_id=optional_uuid(collector_id, "Collector"),
        cooler_id=optional_uuid(cooler_id, "Cooler"),
        date_from=date_from, date_to=date_to, quality_status=quality_status,
        min_litres=min_litres, max_litres=max_litres, search=search,
    )
    coop = optional_uuid(cooperative_id, "Cooperative")
    return collections.list_page(db, admin, coop, filters, params, sorts=collections.PLATFORM_SORTS)


@router.get("/{collection_id}")
def get_collection(collection_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return collections.get_any(db, collection_id)
