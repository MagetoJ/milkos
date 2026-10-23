"""Collection batches and their correction / reversal requests.

  /api/v1/collection-batches                     list (scoped), confirm a new batch
  /api/v1/collection-batches/{id}                one batch with its lines, receipts and request history
  /api/v1/collection-batches/{id}/corrections    request a correction (maker)
  /api/v1/collection-batches/{id}/reversals      request a reversal (maker)
  /api/v1/collection-requests                    correction / reversal requests (scoped)
  /api/v1/collection-requests/{id}/approve|reject|cancel   review (checker) or withdraw

Scope always comes from the caller's account (services/batches.scope): staff see their cooperative, a collector
only the batches they recorded, a farmer only batches with a line of theirs. Platform staff use the superadmin
console. A batch of another cooperative is indistinguishable from a missing one (404).
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_permission
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.api.dependencies.tasks import get_tasks
from app.core.permissions import Permission
from app.core.utils import optional_uuid
from app.domain.interfaces import TaskDispatcher
from app.domain.schemas.collections import BatchCreate, CorrectionRequestCreate, RequestReview, ReversalRequestCreate
from app.infrastructure.db.models.operations import BatchStatus
from app.infrastructure.db.pagination import PageParams
from app.services import background, batches, corrections
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1/collection-batches", tags=["Collection batches"])
requests_router = APIRouter(prefix="/api/v1/collection-requests", tags=["Collection batches"])


NOT_FOR_PLATFORM_STAFF = "Platform administrators use the superadmin console."


@router.get("")
def list_batches(
    search: Optional[str] = Query(None, max_length=100),
    batch_status: Optional[str] = Query(None, alias="status", pattern="^(CONFIRMED|CORRECTION_PENDING|REVERSAL_PENDING|CORRECTED|REVERSED)$"),
    include_history: bool = False,
    cooler_id: Optional[str] = None,
    centre_id: Optional[str] = None,
    collector_id: Optional[str] = None,
    farmer_id: Optional[str] = None,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    result = batches.list_page(
        db, principal, status=batch_status, include_history=include_history,
        cooler_id=optional_uuid(cooler_id, "Cooler"), centre_id=optional_uuid(centre_id, "Centre"),
        collector_id=optional_uuid(collector_id, "Collector"), farmer_id=optional_uuid(farmer_id, "Farmer"),
        date_from=date_from, date_to=date_to, search=search, params=params,
    )
    result["role"] = principal.role
    result["can_record"] = principal.can(Permission.COLLECTION_CREATE)
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def confirm_batch(
    payload: BatchCreate,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
    tasks: TaskDispatcher = Depends(get_tasks),
):
    """Confirm a collection: captured weight + allocation to farmers, in one transaction. Sending the same
    `id` again returns the batch already confirmed (no duplicate). Receipt SMS are sent after the response."""
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    batch, receipts = batches.create(db, principal, payload)
    background.deliver_later(tasks, [n.id for n in receipts], principal)
    return batches.serialize_one(db, batch)


@router.get("/{batch_id}")
def get_batch(
    batch_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    batch = batches.get_scoped(db, principal, batch_id)
    data = corrections.batch_detail(db, batch)
    data["can_request_correction"] = principal.can(Permission.CORRECTION_REQUEST) and batch.status == BatchStatus.CONFIRMED
    data["can_request_reversal"] = principal.can(Permission.REVERSAL_REQUEST) and batch.status == BatchStatus.CONFIRMED
    return data


@router.post("/{batch_id}/corrections", status_code=status.HTTP_201_CREATED)
def request_correction(
    batch_id: str, payload: CorrectionRequestCreate,
    principal: Principal = Depends(require_permission(Permission.CORRECTION_REQUEST)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    request = corrections.request_correction(db, principal, batches.get_scoped(db, principal, batch_id), payload)
    return corrections.serialize(db, [request])[0]


@router.post("/{batch_id}/reversals", status_code=status.HTTP_201_CREATED)
def request_reversal(
    batch_id: str, payload: ReversalRequestCreate,
    principal: Principal = Depends(require_permission(Permission.REVERSAL_REQUEST)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    request = corrections.request_reversal(db, principal, batches.get_scoped(db, principal, batch_id), payload)
    return corrections.serialize(db, [request])[0]


# ---------------- requests ----------------

@requests_router.get("")
def list_requests(
    request_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPROVED|REJECTED|CANCELLED)$"),
    request_type: Optional[str] = Query(None, alias="type", pattern="^(CORRECTION|REVERSAL)$"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    result = corrections.list_page(db, principal, request_status, request_type, params)
    result["can_approve_corrections"] = principal.can(Permission.CORRECTION_APPROVE)
    result["can_approve_reversals"] = principal.can(Permission.REVERSAL_APPROVE)
    result["user_id"] = str(principal.user.id)
    return result


@requests_router.post("/{request_id}/approve")
def approve_request(
    request_id: str, payload: RequestReview,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    request = corrections.approve(db, principal, corrections.get_scoped(db, principal, request_id), payload.comment)
    return corrections.serialize(db, [request])[0]


@requests_router.post("/{request_id}/reject")
def reject_request(
    request_id: str, payload: RequestReview,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    request = corrections.reject(db, principal, corrections.get_scoped(db, principal, request_id), payload.comment)
    return corrections.serialize(db, [request])[0]


@requests_router.post("/{request_id}/cancel")
def cancel_request(
    request_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    principal.require_tenant(NOT_FOR_PLATFORM_STAFF)
    request = corrections.cancel(db, principal, corrections.get_scoped(db, principal, request_id))
    return corrections.serialize(db, [request])[0]
