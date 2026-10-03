"""SMS credit payments (M-Pesa top-ups) awaiting or past verification."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, page_params, paginate
from core.permissions import Permission
from core.utils import like, num, parse_uuid
from db import get_db
from models.admin import AuditLog, SMSCreditPackage, SMSCreditPayment
from models.cooperative import Cooperative
from schemas.platform import PaymentDecision
from services import audit, payments

router = APIRouter(prefix="/payments")

SORTS = {
    "submitted_at": SMSCreditPayment.submitted_at, "amount_kes": SMSCreditPayment.amount_kes,
    "credits_requested": SMSCreditPayment.credits_requested, "cooperative": Cooperative.name,
}


def _query(db: Session):
    return (
        db.query(SMSCreditPayment, Cooperative, SMSCreditPackage)
        .outerjoin(Cooperative, Cooperative.id == SMSCreditPayment.cooperative_id)
        .outerjoin(SMSCreditPackage, SMSCreditPackage.id == SMSCreditPayment.package_id)
    )


def _serialize(row) -> dict:
    return payments.payment_json(*row)


@router.get("/pending")
def get_pending_payments(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    rows = _query(db).filter(SMSCreditPayment.status == "PENDING").order_by(SMSCreditPayment.submitted_at.asc()).all()
    return [_serialize(row) for row in rows]


@router.get("")
def list_payments(
    payment_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|VERIFIED|REJECTED)$"),
    cooperative_id: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=100),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = _query(db)
    if payment_status:
        query = query.filter(SMSCreditPayment.status == payment_status)
    if cooperative_id:
        query = query.filter(SMSCreditPayment.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            Cooperative.name.ilike(pattern, escape="\\"), Cooperative.code.ilike(pattern, escape="\\"),
            SMSCreditPayment.masked_mpesa_ref.ilike(pattern, escape="\\"),
            # A full M-Pesa code finds its payment without ever echoing the stored code back.
            SMSCreditPayment.mpesa_reference == term.upper(),
        ))
    totals = dict(
        (s, (n, num(kes) or 0.0))
        for s, n, kes in db.query(
            SMSCreditPayment.status, func.count(SMSCreditPayment.id), func.coalesce(func.sum(SMSCreditPayment.amount_kes), 0)
        ).group_by(SMSCreditPayment.status)
    )
    result = paginate(
        apply_sort(query, params.sort, SORTS, [SMSCreditPayment.submitted_at.desc(), SMSCreditPayment.id]),
        params, _serialize,
    )
    result["summary"] = {
        key.lower(): {"count": totals.get(key, (0, 0.0))[0], "amount_kes": totals.get(key, (0, 0.0))[1]}
        for key in ("PENDING", "VERIFIED", "REJECTED")
    }
    return result


@router.get("/{payment_id}")
def get_payment(payment_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    pid = parse_uuid(payment_id, "Payment")
    row = _query(db).filter(SMSCreditPayment.id == pid).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    history = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "payment", AuditLog.entity_id == str(pid))
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    return {**_serialize(row), "activity": [audit.entry_json(e) for e in history]}


@router.post("/{payment_id}/action")
def decide_payment(
    payment_id: str, payload: PaymentDecision, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    admin.require(Permission.PAYMENT_VERIFY if payload.action == "VERIFY" else Permission.PAYMENT_REJECT)
    reason = (payload.reason or "").strip() or None
    if payload.action == "REJECT" and (reason is None or len(reason) < 5):
        raise HTTPException(422, "Give a reason (at least 5 characters) when rejecting.")
    payment = payments.decide(db, admin, parse_uuid(payment_id, "Payment"), payload.action, reason)
    return {"success": True, "payment_id": payment_id, "status": payment.status}
