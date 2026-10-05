"""Corrections and reversals of confirmed collection batches (maker-checker).

    request_correction / request_reversal   any role holding the *_REQUEST permission; a collector only for
                                            batches they recorded. The batch becomes CORRECTION_PENDING /
                                            REVERSAL_PENDING; its data is untouched.
    approve / reject                        a different person holding the *_APPROVE permission. The requester
                                            can never review their own request.
    cancel                                  the requester withdraws it.

Approving a CORRECTION creates a new CONFIRMED batch with the proposed values that supersedes the original
(original -> CORRECTED, its lines -> SUPERSEDED). Approving a REVERSAL marks the batch REVERSED and its lines
REVERSED. Nothing is deleted or overwritten. Lines that were already included in a farmer payment produce a
negative payment adjustment for that farmer; the corrected lines are paid by the next payment run.
"""
import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.access import Principal
from core.permissions import Permission
from core.utils import field_error, iso
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from models.operations import (
    BatchStatus, CollectionBatch, CollectionCorrectionRequest, LineStatus, MilkCollection, RequestStatus, RequestType,
    WeightSource,
)
from models.user import User
from schemas.collections import BatchCorrectionProposal, CorrectionRequestCreate, ReversalRequestCreate
from services import audit, batches, farmer_payments, inbox

APPROVERS = {RequestType.CORRECTION: ("COOP_ADMIN", "MANAGER"), RequestType.REVERSAL: ("COOP_ADMIN",)}


def _lines(db: Session, batch: CollectionBatch) -> list[MilkCollection]:
    return db.query(MilkCollection).filter(MilkCollection.batch_id == batch.id).order_by(MilkCollection.reference).all()


def _transition(batch: CollectionBatch, new_status: str) -> None:
    if new_status not in BatchStatus.TRANSITIONS.get(batch.status, set()):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This collection is {batch.status.replace('_', ' ').lower()} and can't become {new_status.replace('_', ' ').lower()}.",
        )
    batch.status = new_status


def _require_open(batch: CollectionBatch) -> None:
    if batch.status in (BatchStatus.CORRECTION_PENDING, BatchStatus.REVERSAL_PENDING):
        raise HTTPException(status.HTTP_409_CONFLICT, "A correction or reversal of this collection is already awaiting review.")
    if batch.status != BatchStatus.CONFIRMED:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This collection was {batch.status.lower()} and can't be changed again.")


def _validate_proposal(db: Session, batch: CollectionBatch, original_lines: list[MilkCollection], proposal: BatchCorrectionProposal) -> None:
    """Dry run of the rules a new batch must pass, so a request that could never be approved is refused now."""
    batches.resolve_cooler(db, batch.cooperative_id, proposal.cooler_id)
    batches.resolve_centre(db, batch.cooperative_id, proposal.centre_id)
    allocations = [(a.farmer_id, batches.kg(a.quantity_kg)) for a in proposal.allocations]
    batches.check_allocation(proposal.captured_weight_kg, allocations)
    batches.resolve_farmers(db, batch.cooperative_id, [f for f, _ in allocations],
                            allow_inactive={line.farmer_id for line in original_lines})
    batches.resolve_quality(db, proposal.quality_status, proposal.rejection_reason, proposal.temperature_c, proposal.fat_percentage)


def _snapshot(db: Session, batch: CollectionBatch, lines: list[MilkCollection]) -> dict:
    return {**batches.content_of(batch, lines), "reference": batch.reference, "status": batch.status,
            "weight_source": batch.weight_source}


def request_correction(db: Session, principal: Principal, batch: CollectionBatch, payload: CorrectionRequestCreate) -> CollectionCorrectionRequest:
    principal.require(Permission.CORRECTION_REQUEST)
    batch = db.get(CollectionBatch, batch.id, with_for_update=True)
    _require_open(batch)
    lines = _lines(db, batch)
    original = _snapshot(db, batch, lines)
    # Fields the request leaves out keep their recorded value (date, time, cooler...).
    merged = {**batches.content_of(batch, lines), **payload.proposed.model_dump(mode="json", exclude_unset=True)}
    proposal = BatchCorrectionProposal.model_validate(merged)
    _validate_proposal(db, batch, lines, proposal)
    proposed = proposal.model_dump(mode="json")
    proposed["allocations"] = [{"farmer_id": a["farmer_id"], "quantity_kg": a["quantity_kg"]} for a in proposed["allocations"]]
    if all(proposed.get(k) == original.get(k) for k in proposed):
        raise field_error("proposed", "The proposed values are the same as the recorded ones.")
    request = CollectionCorrectionRequest(
        cooperative_id=batch.cooperative_id, batch_id=batch.id, request_type=RequestType.CORRECTION,
        status=RequestStatus.PENDING, reason=payload.reason, original_values=original, proposed_values=proposed,
        requested_by=principal.user.id, requested_role=principal.role,
    )
    db.add(request)
    _transition(batch, BatchStatus.CORRECTION_PENDING)
    db.flush()
    audit.record(
        db, principal, "COLLECTION_CORRECTION_REQUESTED", target=f"{batch.reference}: correction requested",
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=batch.cooperative_id,
        old_values=original, new_values={"request_id": str(request.id), "proposed": proposed}, reason=payload.reason,
    )
    inbox.notify(
        db, cooperative_id=batch.cooperative_id, roles=APPROVERS[RequestType.CORRECTION], category="COLLECTION",
        type="CORRECTION_REQUESTED", severity="WARNING", title=f"Correction requested for {batch.reference}",
        body=f"{principal.user.full_name}: {payload.reason}", entity_type="correction_request", entity_id=request.id,
        link="/cooperatives/corrections",
    )
    db.commit()
    db.refresh(request)
    return request


def request_reversal(db: Session, principal: Principal, batch: CollectionBatch, payload: ReversalRequestCreate) -> CollectionCorrectionRequest:
    principal.require(Permission.REVERSAL_REQUEST)
    batch = db.get(CollectionBatch, batch.id, with_for_update=True)
    _require_open(batch)
    lines = _lines(db, batch)
    original = _snapshot(db, batch, lines)
    request = CollectionCorrectionRequest(
        cooperative_id=batch.cooperative_id, batch_id=batch.id, request_type=RequestType.REVERSAL,
        status=RequestStatus.PENDING, reason=payload.reason, original_values=original, proposed_values=None,
        requested_by=principal.user.id, requested_role=principal.role,
    )
    db.add(request)
    _transition(batch, BatchStatus.REVERSAL_PENDING)
    db.flush()
    audit.record(
        db, principal, "COLLECTION_REVERSAL_REQUESTED", target=f"{batch.reference}: reversal requested",
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=batch.cooperative_id,
        old_values=original, new_values={"request_id": str(request.id)}, reason=payload.reason,
    )
    inbox.notify(
        db, cooperative_id=batch.cooperative_id, roles=APPROVERS[RequestType.REVERSAL], category="COLLECTION",
        type="REVERSAL_REQUESTED", severity="CRITICAL", title=f"Reversal requested for {batch.reference}",
        body=f"{principal.user.full_name}: {payload.reason}", entity_type="correction_request", entity_id=request.id,
        link="/cooperatives/corrections",
    )
    db.commit()
    db.refresh(request)
    return request


def _reviewable(db: Session, principal: Principal, request: CollectionCorrectionRequest) -> CollectionBatch:
    principal.require(Permission.CORRECTION_APPROVE if request.request_type == RequestType.CORRECTION else Permission.REVERSAL_APPROVE)
    if request.status != RequestStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request was already {request.status.lower()}.")
    if request.requested_by == principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't review your own request. Another authorised person must do it.")
    return db.get(CollectionBatch, request.batch_id, with_for_update=True)


def _skip_unsent_receipts(db: Session, line_ids: list[UUID], why: str) -> None:
    for n in db.query(Notification).filter(
        Notification.collection_id.in_(line_ids),
        Notification.status.in_((NotificationStatus.PENDING, NotificationStatus.PENDING_PROVIDER, NotificationStatus.FAILED)),
    ):
        n.status = NotificationStatus.SKIPPED
        n.error = why
        n.next_attempt_at = None


def approve(db: Session, principal: Principal, request: CollectionCorrectionRequest, comment: Optional[str]) -> CollectionCorrectionRequest:
    request = db.get(CollectionCorrectionRequest, request.id, with_for_update=True)
    batch = _reviewable(db, principal, request)
    lines = _lines(db, batch)
    now = datetime.datetime.utcnow()
    result: Optional[CollectionBatch] = None

    if request.request_type == RequestType.CORRECTION:
        proposal = BatchCorrectionProposal.model_validate(request.proposed_values)
        cooperative = db.get(Cooperative, batch.cooperative_id)
        cooler = batches.resolve_cooler(db, batch.cooperative_id, proposal.cooler_id)
        centre = batches.resolve_centre(db, batch.cooperative_id, proposal.centre_id)
        from models.operations import Collector

        collector = db.get(Collector, batch.collector_id) if batch.collector_id else None
        weight_changed = batches.kg(proposal.captured_weight_kg) != batches.kg(batch.captured_weight_kg)
        result, new_lines, _ = batches.persist(
            db, principal, cooperative=cooperative, content=proposal.model_dump(),
            # A weight typed in by a reviewer is a manual figure, never a scale reading.
            weight_source=WeightSource.MANUAL if weight_changed and batch.weight_source != WeightSource.LITRES else batch.weight_source,
            collector=collector, cooler=cooler, centre=centre, supersedes=batch,
            factor=batch.density_kg_per_litre,
            extra={
                "scale_name": None if weight_changed else batch.scale_name,
                "scale_identifier": None if weight_changed else batch.scale_identifier,
                "started_at": batch.started_at, "captured_at": batch.captured_at, "send_receipts": False,
            },
            allow_inactive_farmers={line.farmer_id for line in lines},
        )
        _transition(batch, BatchStatus.CORRECTED)
        batch.superseded_by_batch_id = result.id
        for line in lines:
            line.record_status = LineStatus.SUPERSEDED
        request.resulting_batch_id = result.id
        action, effect, source = "COLLECTION_CORRECTION_APPROVED", f"corrected by {result.reference}", "CORRECTION"
    else:
        _transition(batch, BatchStatus.REVERSED)
        for line in lines:
            line.record_status = LineStatus.REVERSED
        action, effect, source = "COLLECTION_REVERSAL_APPROVED", "reversed", "REVERSAL"

    _skip_unsent_receipts(db, [line.id for line in lines], f"Collection {effect} before the receipt was sent.")
    adjustments = farmer_payments.adjust_for_lines(
        db, principal, lines, source_type=source, source_id=request.id,
        reason=f"{batch.reference} {effect}: {request.reason}",
    )
    request.status = RequestStatus.APPROVED
    request.reviewed_by = principal.user.id
    request.reviewed_at = now
    request.review_comment = comment
    audit.record(
        db, principal, action, target=f"{batch.reference}: {effect}",
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=batch.cooperative_id,
        old_values=request.original_values,
        new_values={
            "request_id": str(request.id), "status": batch.status,
            "resulting_batch": result.reference if result else None,
            "payment_adjustments": [{"farmer_id": str(a.farmer_id), "amount": float(a.amount)} for a in adjustments],
            "comment": comment,
        },
        reason=request.reason,
    )
    _tell_requester(db, request, batch, approved=True, comment=comment)
    db.commit()
    db.refresh(request)
    return request


def reject(db: Session, principal: Principal, request: CollectionCorrectionRequest, comment: Optional[str]) -> CollectionCorrectionRequest:
    request = db.get(CollectionCorrectionRequest, request.id, with_for_update=True)
    batch = _reviewable(db, principal, request)
    if not comment or len(comment) < 3:
        raise field_error("comment", "Say why the request is rejected.")
    _transition(batch, BatchStatus.CONFIRMED)
    request.status = RequestStatus.REJECTED
    request.reviewed_by = principal.user.id
    request.reviewed_at = datetime.datetime.utcnow()
    request.review_comment = comment
    kind = "CORRECTION" if request.request_type == RequestType.CORRECTION else "REVERSAL"
    audit.record(
        db, principal, f"COLLECTION_{kind}_REJECTED", target=f"{batch.reference}: {kind.lower()} rejected",
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=batch.cooperative_id,
        new_values={"request_id": str(request.id), "comment": comment},
    )
    _tell_requester(db, request, batch, approved=False, comment=comment)
    db.commit()
    db.refresh(request)
    return request


def cancel(db: Session, principal: Principal, request: CollectionCorrectionRequest) -> CollectionCorrectionRequest:
    request = db.get(CollectionCorrectionRequest, request.id, with_for_update=True)
    if request.status != RequestStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request was already {request.status.lower()}.")
    if request.requested_by != principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who made the request can withdraw it.")
    batch = db.get(CollectionBatch, request.batch_id, with_for_update=True)
    _transition(batch, BatchStatus.CONFIRMED)
    request.status = RequestStatus.CANCELLED
    audit.record(
        db, principal, "COLLECTION_CHANGE_REQUEST_CANCELLED", target=f"{batch.reference}: request withdrawn",
        entity_type="collection_batch", entity_id=batch.id, cooperative_id=batch.cooperative_id,
        new_values={"request_id": str(request.id), "type": request.request_type},
    )
    db.commit()
    db.refresh(request)
    return request


def _tell_requester(db: Session, request: CollectionCorrectionRequest, batch: CollectionBatch, *, approved: bool, comment: Optional[str]) -> None:
    if request.requested_by is None:
        return
    kind = "Correction" if request.request_type == RequestType.CORRECTION else "Reversal"
    inbox.notify(
        db, cooperative_id=batch.cooperative_id, recipient_user_id=request.requested_by, category="COLLECTION",
        type=f"{kind.upper()}_{'APPROVED' if approved else 'REJECTED'}", severity="INFO" if approved else "WARNING",
        title=f"{kind} of {batch.reference} {'approved' if approved else 'rejected'}", body=comment,
        entity_type="correction_request", entity_id=request.id,
    )


def _farmer_ids(request: CollectionCorrectionRequest) -> set[str]:
    ids = set()
    for values in (request.original_values or {}, request.proposed_values or {}):
        for a in values.get("allocations") or []:
            if a.get("farmer_id"):
                ids.add(str(a["farmer_id"]))
    return ids


def request_json(request: CollectionCorrectionRequest, batch: CollectionBatch, names: dict[UUID, str],
                 resulting_reference: Optional[str] = None, farmer_names: Optional[dict[str, str]] = None) -> dict:
    return {
        "id": str(request.id),
        "cooperative_id": str(request.cooperative_id),
        "batch_id": str(request.batch_id),
        "batch_reference": batch.reference,
        "batch_status": batch.status,
        "request_type": request.request_type,
        "status": request.status,
        "reason": request.reason,
        "original_values": request.original_values,
        "proposed_values": request.proposed_values,
        "requested_by": str(request.requested_by) if request.requested_by else None,
        "requested_by_name": names.get(request.requested_by),
        "requested_role": request.requested_role,
        "reviewed_by": str(request.reviewed_by) if request.reviewed_by else None,
        "reviewed_by_name": names.get(request.reviewed_by),
        "reviewed_at": iso(request.reviewed_at),
        "review_comment": request.review_comment,
        "resulting_batch_id": str(request.resulting_batch_id) if request.resulting_batch_id else None,
        "resulting_batch_reference": resulting_reference,
        # "Name (F-0001)" for every farmer in the recorded or proposed allocations.
        "farmer_names": {fid: farmer_names[fid] for fid in _farmer_ids(request) if farmer_names and fid in farmer_names},
        "created_at": iso(request.created_at),
    }


def serialize(db: Session, requests: list[CollectionCorrectionRequest]) -> list[dict]:
    batch_ids = {r.batch_id for r in requests} | {r.resulting_batch_id for r in requests if r.resulting_batch_id}
    found = {b.id: b for b in db.query(CollectionBatch).filter(CollectionBatch.id.in_(batch_ids))} if batch_ids else {}
    user_ids = {r.requested_by for r in requests if r.requested_by} | {r.reviewed_by for r in requests if r.reviewed_by}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids))} if user_ids else {}
    from models.farmer import Farmer

    farmer_ids = set().union(*(_farmer_ids(r) for r in requests)) if requests else set()
    farmer_uuids = []
    for fid in farmer_ids:
        try:
            farmer_uuids.append(UUID(fid))
        except ValueError:
            pass
    farmer_names = {
        str(f.id): f"{f.full_name} ({f.farmer_number})" for f in db.query(Farmer).filter(Farmer.id.in_(farmer_uuids))
    } if farmer_uuids else {}
    return [
        request_json(r, found[r.batch_id], names, found[r.resulting_batch_id].reference if r.resulting_batch_id in found else None,
                     farmer_names)
        for r in requests if r.batch_id in found
    ]
