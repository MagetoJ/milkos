from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.domain.schemas.platform import CollectorCreate, CollectorUpdate, StatusChange
from app.infrastructure.db.pagination import PageParams
from app.services import collectors
from app.services.platform_admin import people
from app.services.principal import Principal

router = APIRouter(prefix="/collectors")


@router.get("")
def list_collectors(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    collector_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return people.collectors_page(
        db, search=search,
        cooperative_id=optional_uuid(cooperative_id, "Cooperative"),
        cooler_id=optional_uuid(cooler_id, "Cooler"),
        status=collector_status, params=params,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_collector(payload: CollectorCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return people.create_collector(db, admin, payload)


@router.get("/{collector_id}")
def get_collector(collector_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return people.collector_json(db, people.get_collector(db, collector_id))


@router.put("/{collector_id}")
def update_collector(
    collector_id: str, payload: CollectorUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return people.collector_json(db, collectors.update(db, admin, people.get_collector(db, collector_id), payload))


@router.patch("/{collector_id}/status")
def change_collector_status(
    collector_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    profile = collectors.update(db, admin, people.get_collector(db, collector_id), CollectorUpdate(status=payload.status))
    return people.collector_json(db, profile)
