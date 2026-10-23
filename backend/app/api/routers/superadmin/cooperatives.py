from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import parse_uuid
from app.domain.schemas.platform import (
    CooperativeCreate, CooperativeStatusChange, CooperativeUpdate, SmsCreditAdjustment,
)
from app.infrastructure.db.pagination import PageParams
from app.services import cooperatives
from app.services.platform_admin import cooperatives as platform
from app.services.principal import Principal

router = APIRouter(prefix="/cooperatives")


@router.get("")
def list_cooperatives(
    search: Optional[str] = Query(None, max_length=100),
    coop_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|SUSPENDED)$"),
    county: Optional[str] = Query(None, max_length=50),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return platform.list_page(db, search, coop_status, county, params)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cooperative(
    payload: CooperativeCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return platform.summary_json(db, cooperatives.create(db, admin, payload))


@router.get("/{coop_id}")
def get_cooperative(coop_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return platform.detail(db, platform.get(db, coop_id))


@router.put("/{coop_id}")
def update_cooperative(
    coop_id: str, payload: CooperativeUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return platform.summary_json(db, cooperatives.update(db, admin, platform.get(db, coop_id), payload))


@router.patch("/{coop_id}/status")
def change_cooperative_status(
    coop_id: str, payload: CooperativeStatusChange, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    coop = cooperatives.set_status(db, admin, parse_uuid(coop_id, "Cooperative"), payload.status, payload.reason)
    return cooperatives.cooperative_json(coop)


@router.get("/{coop_id}/sms-ledger")
def sms_ledger(coop_id: str, limit: int = 50, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    """Derived balances and the latest ledger entries of one cooperative."""
    return platform.sms_ledger(db, coop_id, limit)


@router.post("/{coop_id}/sms-credits")
def adjust_sms_credits(
    coop_id: str, payload: SmsCreditAdjustment, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    coop = cooperatives.adjust_sms_credits(db, admin, parse_uuid(coop_id, "Cooperative"), payload.delta, payload.reason)
    return cooperatives.cooperative_json(coop)
