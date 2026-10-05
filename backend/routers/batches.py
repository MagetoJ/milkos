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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal, require_permission
from core.pagination import PageParams, apply_sort, fetch_page, page_params, page_result
from core.permissions import Permission
from core.utils import like, parse_uuid
from db import get_db
from models.operations import BatchStatus, CollectionBatch, CollectionCorrectionRequest, MilkCollection, RequestStatus
from schemas.auth import UserRole
from schemas.collections import BatchCreate, CorrectionRequestCreate, RequestReview, ReversalRequestCreate
from services import batches, corrections, notifications

router = APIRouter(prefix="/api/v1/collection-batches", tags=["Collection batches"])
requests_router = APIRouter(prefix="/api/v1/collection-requests", tags=["Collection batches"])

SORTS = {
    "collection_date": CollectionBatch.collection_date, "captured_weight_kg": CollectionBatch.captured_weight_kg,
    "created_at": CollectionBatch.created_at,
}
DEFAULT_ORDER = [CollectionBatch.collection_date.desc(), CollectionBatch.collection_time.desc(), CollectionBatch.id]


def _tenant(principal: Principal) -> Principal:
    if principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform administrators use the superadmin console.")
    return principal


def _batch(db: Session, principal: Principal, raw_id: str) -> CollectionBatch:
    row = batches.scope(db.query(CollectionBatch), principal).filter(
        CollectionBatch.id == parse_uuid(raw_id, "Collection")
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    return row


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
    _tenant(principal)
    query = batches.scope(db.query(CollectionBatch), principal)
    if batch_status:
        query = query.filter(CollectionBatch.status == batch_status)
    elif not include_history:
        query = query.filter(CollectionBatch.status.in_(BatchStatus.EFFECTIVE))
    if cooler_id:
        query = query.filter(CollectionBatch.cooler_id == parse_uuid(cooler_id, "Cooler"))
    if centre_id:
        query = query.filter(CollectionBatch.centre_id == parse_uuid(centre_id, "Centre"))
    if collector_id:
        query = query.filter(CollectionBatch.collector_id == parse_uuid(collector_id, "Collector"))
    if farmer_id:
        query = query.filter(CollectionBatch.id.in_(
            db.query(MilkCollection.batch_id).filter(MilkCollection.farmer_id == parse_uuid(farmer_id, "Farmer"))
        ))
    if date_from:
        query = query.filter(CollectionBatch.collection_date >= date_from)
    if date_to:
        query = query.filter(CollectionBatch.collection_date <= date_to)
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            CollectionBatch.reference.ilike(pattern, escape="\\"),
            CollectionBatch.id.in_(db.query(MilkCollection.batch_id).filter(MilkCollection.reference.ilike(pattern, escape="\\"))),
        ))
    rows, total = fetch_page(apply_sort(query, params.sort, SORTS, DEFAULT_ORDER), params)
    result = page_result(batches.serialize_many(db, rows), total, params)
    result["summary"] = batches.summarize(query)
    result["role"] = principal.role
    result["can_record"] = principal.can(Permission.COLLECTION_CREATE)
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def confirm_batch(
    payload: BatchCreate,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
):
    """Confirm a collection: captured weight + allocation to farmers, in one transaction. Sending the same
    `id` again returns the batch already confirmed (no duplicate)."""
    _tenant(principal)
    batch, receipts = batches.create(db, principal, payload)
    if receipts:
        notifications.dispatch(db, [n.id for n in receipts], principal)
    db.refresh(batch)
    return batches.serialize_many(db, [batch])[0]


@router.get("/{batch_id}")
def get_batch(
    batch_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    batch = _batch(db, principal, batch_id)
    data = batches.serialize_many(db, [batch])[0]
    history = (
        db.query(CollectionCorrectionRequest).filter(CollectionCorrectionRequest.batch_id == batch.id)
        .order_by(CollectionCorrectionRequest.created_at.desc()).all()
    )
    data["requests"] = corrections.serialize(db, history)
    data["can_request_correction"] = principal.can(Permission.CORRECTION_REQUEST) and batch.status == BatchStatus.CONFIRMED
    data["can_request_reversal"] = principal.can(Permission.REVERSAL_REQUEST) and batch.status == BatchStatus.CONFIRMED
    return data


@router.post("/{batch_id}/corrections", status_code=status.HTTP_201_CREATED)
def request_correction(
    batch_id: str, payload: CorrectionRequestCreate,
    principal: Principal = Depends(require_permission(Permission.CORRECTION_REQUEST)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    request = corrections.request_correction(db, principal, _batch(db, principal, batch_id), payload)
    return corrections.serialize(db, [request])[0]


@router.post("/{batch_id}/reversals", status_code=status.HTTP_201_CREATED)
def request_reversal(
    batch_id: str, payload: ReversalRequestCreate,
    principal: Principal = Depends(require_permission(Permission.REVERSAL_REQUEST)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    request = corrections.request_reversal(db, principal, _batch(db, principal, batch_id), payload)
    return corrections.serialize(db, [request])[0]


# ---------------- requests ----------------

def _requests_scope(db: Session, principal: Principal):
    query = db.query(CollectionCorrectionRequest).filter(CollectionCorrectionRequest.cooperative_id == principal.cooperative_id)
    if principal.role not in (UserRole.COOP_ADMIN.value, UserRole.MANAGER.value):
        query = query.filter(CollectionCorrectionRequest.requested_by == principal.user.id)
    return query


def _request(db: Session, principal: Principal, raw_id: str) -> CollectionCorrectionRequest:
    row = _requests_scope(db, principal).filter(CollectionCorrectionRequest.id == parse_uuid(raw_id, "Request")).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    return row


@requests_router.get("")
def list_requests(
    request_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPROVED|REJECTED|CANCELLED)$"),
    request_type: Optional[str] = Query(None, alias="type", pattern="^(CORRECTION|REVERSAL)$"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    query = _requests_scope(db, principal)
    if request_status:
        query = query.filter(CollectionCorrectionRequest.status == request_status)
    if request_type:
        query = query.filter(CollectionCorrectionRequest.request_type == request_type)
    rows, total = fetch_page(query.order_by(CollectionCorrectionRequest.created_at.desc(), CollectionCorrectionRequest.id), params)
    result = page_result(corrections.serialize(db, rows), total, params)
    result["pending"] = _requests_scope(db, principal).filter(CollectionCorrectionRequest.status == RequestStatus.PENDING).count()
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
    _tenant(principal)
    request = corrections.approve(db, principal, _request(db, principal, request_id), payload.comment)
    return corrections.serialize(db, [request])[0]


@requests_router.post("/{request_id}/reject")
def reject_request(
    request_id: str, payload: RequestReview,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    request = corrections.reject(db, principal, _request(db, principal, request_id), payload.comment)
    return corrections.serialize(db, [request])[0]


@requests_router.post("/{request_id}/cancel")
def cancel_request(
    request_id: str,
    principal: Principal = Depends(require_permission(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
):
    _tenant(principal)
    request = corrections.cancel(db, principal, _request(db, principal, request_id))
    return corrections.serialize(db, [request])[0]
