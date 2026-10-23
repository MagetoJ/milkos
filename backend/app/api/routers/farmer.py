"""The farmer's own view: /api/v1/farmer (FARMER accounts only).

Everything is scoped to the farmer record linked to the signed-in account (Principal.farmer_profile);
no endpoint takes a farmer, cooperative or collection id from another farmer. Read-only: a farmer can't change
collections, prices, payments, their member number or their cooperative. See app.services.farmer_portal.
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_roles
from app.api.dependencies.db import get_db
from app.domain.schemas.auth import UserRole
from app.services import farmer_portal
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1/farmer", tags=["Farmer"])
farmer_only = require_roles(UserRole.FARMER)


@router.get("/dashboard")
def dashboard(
    range: str = Query("7d", pattern="^(today|7d|30d|3m|custom)$"),
    date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
    principal: Principal = Depends(farmer_only), db: Session = Depends(get_db),
):
    return farmer_portal.dashboard(db, principal, range, date_from, date_to)


@router.get("/collections")
def my_collections(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
    principal: Principal = Depends(farmer_only), db: Session = Depends(get_db),
):
    return farmer_portal.collections_page(db, principal, page, page_size, date_from, date_to)


@router.get("/collections/{collection_id}")
def my_collection(collection_id: str, principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    return farmer_portal.collection_detail(db, principal, collection_id)


@router.get("/payments")
def my_payments(principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    return farmer_portal.payments(db, principal)


@router.get("/prices")
def price_history(principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    """The cooperative's milk prices over time (what each delivery was or will be paid at)."""
    return farmer_portal.price_history(db, principal)
