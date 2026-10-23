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

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_permission
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.permissions import Permission
from app.core.utils import optional_uuid
from app.domain.schemas.platform import CollectionCreate, CollectionUpdate
from app.infrastructure.db.pagination import PageParams
from app.services import collections
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1/collections", tags=["Collections"])


NOT_FOR_PLATFORM_STAFF = "Platform administrators use /api/v1/superadmin/collections."


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
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    filters = dict(
        farmer_id=optional_uuid(farmer_id, "Farmer"), collector_id=optional_uuid(collector_id, "Collector"),
        cooler_id=optional_uuid(cooler_id, "Cooler"),
        date_from=date_from, date_to=date_to, quality_status=quality_status, search=search,
        batch_id=optional_uuid(batch_id, "Collection"), centre_id=optional_uuid(centre_id, "Centre"),
        include_history=include_history or bool(batch_id),
    )
    # A cooperative_id other than the caller's own is refused (403) inside the service's scope().
    result = collections.list_page(db, principal, optional_uuid(cooperative_id, "Cooperative"), filters, params)
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
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    collection = collections.create(db, principal, payload)
    return collections.collection_json(collections.load_row(db, collection.id))


@router.get("/options")
def recording_options(
    search: Optional[str] = Query(None, max_length=100),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
):
    """Active farmers (searchable), coolers, centres and collectors to choose from when recording milk."""
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    return collections.recording_options(db, principal, search)


@router.get("/{collection_id}")
def get_collection(
    collection_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    return collections.get_scoped(db, principal, collection_id)


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
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    return collections.complete_lab_result(db, principal, collection_id, payload.model_dump(exclude_unset=True))
