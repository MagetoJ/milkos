from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.domain.schemas.cooperative_module import FarmerCreate, FarmerUpdate
from app.domain.schemas.platform import StatusChange
from app.infrastructure.db.pagination import PageParams
from app.services import farmers
from app.services.platform_admin import people
from app.services.principal import Principal

router = APIRouter(prefix="/farmers")


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
    return people.farmers_page(
        db, search=search,
        cooperative_id=optional_uuid(cooperative_id, "Cooperative"),
        centre_id=optional_uuid(centre_id, "Collection centre"),
        status=farmer_status, params=params,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_farmer(payload: FarmerCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    farmer, _ = farmers.create(db, admin, payload)
    return people.farmer_json(db, farmer)


@router.get("/{farmer_id}")
def get_farmer(farmer_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return people.farmer_detail(db, admin, people.get_farmer(db, farmer_id))


@router.put("/{farmer_id}")
def update_farmer(
    farmer_id: str, payload: FarmerUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return people.farmer_json(db, farmers.update(db, admin, people.get_farmer(db, farmer_id), payload))


@router.patch("/{farmer_id}/status")
def change_farmer_status(
    farmer_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    farmer = farmers.update(db, admin, people.get_farmer(db, farmer_id), FarmerUpdate(status=payload.status))
    return people.farmer_json(db, farmer)
