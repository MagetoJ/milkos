import logging
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.notifications import notify_applicant
from core.onboarding import generate_cooperative_code
from db import get_db
from models.admin import AuditLog, CooperativeApplication, Cooler, SMSCreditPayment
from models.cooperative import Cooperative
from models.user import User
from routers.auth import require_roles
from schemas.auth import UserRole

router = APIRouter(prefix="/api/v1/superadmin", tags=["Super Admin"])
logger = logging.getLogger("milkflow.superadmin")

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


def applicant_account(db: Session, record: CooperativeApplication) -> Optional[User]:
    """The COOP_ADMIN user created at registration. Applications from before admin_user_id existed fall back to email."""
    if record.admin_user_id:
        return db.get(User, record.admin_user_id)
    return db.query(User).filter(User.email == record.email, User.role == UserRole.COOP_ADMIN).first()


# ---------- read endpoints ----------

@router.get("/stats")
def get_superadmin_stats(db: Session = Depends(get_db), _admin: dict = Depends(require_superadmin)):
    return {
        "total_cooperatives": db.query(Cooperative).count(),
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
            "registration_number": a.registration_number,
            "kra_pin": a.kra_pin,
            "county": a.county,
            "sub_county": a.sub_county,
            "admin_id_number": a.admin_id_number,
            "estimated_daily_liters": float(a.estimated_daily_liters) if a.estimated_daily_liters is not None else None,
            "initial_coolers_count": a.initial_coolers_count,
            "additional_info": a.additional_info,
            "flags": a.flags or [],
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
    # Row lock (Postgres) so two superadmins deciding at once are serialised.
    record = db.get(CooperativeApplication, parse_uuid(app_id, "Application"), with_for_update=True)
    if not record:
        raise HTTPException(status_code=404, detail="Application not found")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"This application was already {record.status.lower()}.")

    approved = payload.action == "APPROVE"
    applicant = applicant_account(db, record)
    cooperative = None

    if approved:
        if not (record.registration_number and record.kra_pin and record.county):
            raise HTTPException(
                status_code=422,
                detail="This application is missing its registration number, KRA PIN or county. "
                       "Reject it and ask the applicant to apply again.",
            )
        if not applicant:
            raise HTTPException(
                status_code=409,
                detail="The applicant's account no longer exists. Reject this application and ask them to apply again.",
            )

    # Everything below is one transaction: either all of it is saved or none of it.
    # These models have no relationship()s, so the unit of work can't infer insert order from
    # foreign keys; the explicit flushes put each row in place before anything points at it.
    try:
        if approved:
            cooperative = Cooperative(
                name=record.org_name,
                code=generate_cooperative_code(db, record.org_name),
                registration_number=record.registration_number,
                kra_pin=record.kra_pin,
                county=record.county,
                location=record.sub_county,
                estimated_daily_liters=record.estimated_daily_liters,
            )
            db.add(cooperative)
            db.flush()
            applicant.is_active = True
            applicant.cooperative_id = cooperative.id
            record.admin_user_id = applicant.id
            record.cooperative_id = cooperative.id
        else:
            record.rejection_reason = reason
            # Free the email/phone so the applicant can apply again. Only an account that was never
            # activated or attached to a cooperative is removed.
            if applicant and not applicant.is_active and applicant.cooperative_id is None \
                    and applicant.role == UserRole.COOP_ADMIN:
                record.admin_user_id = None
                db.flush()
                db.delete(applicant)

        record.status = "APPROVED" if approved else "REJECTED"
        record.reviewed_by = UUID(admin["sub"])
        record.reviewed_at = datetime.utcnow()
        target = f"{record.org_name} ({cooperative.code})" if cooperative else record.org_name
        audit(db, admin, "APPLICATION_APPROVED" if approved else "APPLICATION_REJECTED", target, reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.warning("Decision on application %s hit a constraint", app_id, exc_info=True)
        raise HTTPException(
            status_code=409,
            detail="A cooperative with this registration number or KRA PIN already exists. Reject this application.",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Saving the decision on application %s failed", app_id)
        raise HTTPException(status_code=500, detail="Could not save the decision. Try again.")

    notify_applicant(record, "APPLICATION_APPROVED" if approved else "APPLICATION_REJECTED")
    return {
        "success": True,
        "application_id": app_id,
        "status": record.status,
        "cooperative_id": str(cooperative.id) if cooperative else None,
    }


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
