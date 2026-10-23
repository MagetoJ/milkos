from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.domain.schemas.platform import CoolerCreate, CoolerUpdate, StatusChange
from app.infrastructure.db.pagination import PageParams
from app.services import coolers
from app.services.platform_admin import equipment
from app.services.principal import Principal

router = APIRouter(prefix="/coolers")


@router.get("")
def list_coolers(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    cooler_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    operational: Optional[bool] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return equipment.coolers_page(
        db, search=search, cooperative_id=optional_uuid(cooperative_id, "Cooperative"),
        status=cooler_status, operational=operational, params=params,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cooler(payload: CoolerCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return equipment.cooler_json(db, coolers.create(db, admin, payload))


@router.get("/{cooler_id}")
def get_cooler(cooler_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return equipment.cooler_json(db, equipment.get_cooler(db, cooler_id))


@router.put("/{cooler_id}")
def update_cooler(
    cooler_id: str, payload: CoolerUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return equipment.cooler_json(db, coolers.update(db, admin, equipment.get_cooler(db, cooler_id), payload))


@router.patch("/{cooler_id}/status")
def change_cooler_status(
    cooler_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    cooler = coolers.update(db, admin, equipment.get_cooler(db, cooler_id), CoolerUpdate(status=payload.status))
    return equipment.cooler_json(db, cooler)
