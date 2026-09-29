from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import get_db
from models.admin import AuditLog, CooperativeApplication, Cooler, SMSCreditPayment
from models.user import User
from routers.auth import require_roles
from schemas.auth import UserRole

router = APIRouter(prefix="/api/v1/superadmin", tags=["Super Admin"])

# Every endpoint below requires a SUPER_ADMIN; the dependency also returns the token payload.
require_superadmin = require_roles([UserRole.SUPER_ADMIN])


# ---------- helpers ----------

class ApplicationAction(BaseModel):
    action: Literal["APPROVE", "REJECT"]
    reason: Optional[str] = Field(default=None, max_length=500)


class PaymentAction(BaseModel):
    action: Literal["VERIFY", "REJECT"]
    reason: Optional[str] = Field(default=None, max_length=500)


def iso(value: Optional[datetime]) -> Optional[str]:
    """Columns store naive UTC; mark them as UTC so browsers don't read them as local time."""
    if value is None:
        return None
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


def parse_uuid(value: str, what: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found")


def require_reason(action: str, reason: Optional[str]) -> Optional[str]:
    cleaned = (reason or "").strip()
    if action == "REJECT" and len(cleaned) < 5:
        raise HTTPException(status_code=422, detail="Give a reason (at least 5 characters) when rejecting.")
    return cleaned or None


def audit(db: Session, admin: dict, action: str, target: str, reason: Optional[str] = None) -> None:
    """Added in the same transaction as the change it records."""
    text = f"{target} (reason: {reason})" if reason else target
    db.add(AuditLog(admin_id=UUID(admin["sub"]), action=action, target=text[:500]))


# ---------- read endpoints ----------

@router.get("/stats")
def get_superadmin_stats(db: Session = Depends(get_db), _admin: dict = Depends(require_superadmin)):
    return {
        "total_cooperatives": db.query(func.count(User.cooperative_id.distinct())).scalar() or 0,
        "total_coolers": db.query(Cooler).count(),
        "total_farmers": db.query(User).filter(User.role == UserRole.FARMER).count(),
        "milk_today_kg": 0.0,  # TODO: sum today's collections once the collections table exists
        "pending_applications_count": db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == "PENDING").count(),
        "pending_payments_count": db.query(SMSCreditPayment)
        .filter(SMSCreditPayment.status == "PENDING").count(),
    }


@router.get("/applications/pending")
def get_pending_applications(db: Session = Depends(get_db), _admin: dict = Depends(require_superadmin)):
    rows = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == "PENDING")
        .order_by(CooperativeApplication.created_at.asc())
        .all()
    )
    return [
        {
            "id": str(a.id),
            "org_name": a.org_name,
            "applicant_name": a.applicant_name,
            "email": a.email,
            "phone": a.phone,
            "location": a.location,
            "status": a.status,
            "created_at": iso(a.created_at),
        }
        for a in rows
    ]


@router.get("/payments/pending")
def get_pending_payments(db: Session = Depends(get_db), _admin: dict = Depends(require_superadmin)):
    rows = (
        db.query(SMSCreditPayment)
        .filter(SMSCreditPayment.status == "PENDING")
        .order_by(SMSCreditPayment.submitted_at.asc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "cooperative_id": str(p.cooperative_id) if p.cooperative_id else None,
            # TODO: join the cooperatives table for its name once it has a SQLAlchemy model.
            "cooperative_name": None,
            "package_name": None,
            "amount_kes": float(p.amount_kes),
            "credits_requested": int(p.credits_requested),
            "masked_mpesa_ref": p.masked_mpesa_ref,
            "status": p.status,
            "submitted_at": iso(p.submitted_at),
        }
        for p in rows
    ]


@router.get("/activity")
def get_activity(
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_superadmin),
):
    rows = (
        db.query(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.admin_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": str(log.id),
            "action": log.action,
            "target": log.target,
            "admin_email": email,
            "created_at": iso(log.created_at),
        }
        for log, email in rows
    ]


# ---------- decisions ----------

@router.post("/applications/{app_id}/action")
def process_application_action(
    app_id: str,
    payload: ApplicationAction,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_superadmin),
):
    reason = require_reason(payload.action, payload.reason)
    record = db.get(CooperativeApplication, parse_uuid(app_id, "Application"))
    if not record:
        raise HTTPException(status_code=404, detail="Application not found")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"This application was already {record.status.lower()}.")

    approved = payload.action == "APPROVE"
    record.status = "APPROVED" if approved else "REJECTED"
    # TODO on approve: create the cooperative and its COOP_ADMIN user here, in the same transaction.
    audit(db, admin, "APPLICATION_APPROVED" if approved else "APPLICATION_REJECTED", record.org_name, reason)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not save the decision. Try again.")
    return {"success": True, "application_id": app_id, "status": record.status}


@router.post("/payments/{payment_id}/action")
def verify_payment_action(
    payment_id: str,
    payload: PaymentAction,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_superadmin),
):
    reason = require_reason(payload.action, payload.reason)
    payment = db.get(SMSCreditPayment, parse_uuid(payment_id, "Payment"))
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"This payment was already {payment.status.lower()}.")

    verified = payload.action == "VERIFY"
    payment.status = "VERIFIED" if verified else "REJECTED"
    # TODO on verify: add payment.credits_requested to the cooperative's SMS balance here.
    target = f"{int(payment.credits_requested):,} credits, KES {float(payment.amount_kes):,.0f}, ref {payment.masked_mpesa_ref}"
    audit(db, admin, "PAYMENT_VERIFIED" if verified else "PAYMENT_REJECTED", target, reason)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not save the decision. Try again.")
    return {"success": True, "payment_id": payment_id, "status": payment.status}
