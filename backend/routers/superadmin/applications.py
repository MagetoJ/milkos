"""Cooperative onboarding applications: the review queue and approve/reject decisions."""
import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.notifications import notify_applicant
from core.onboarding import generate_cooperative_code
from core.pagination import PageParams, apply_sort, page_params, paginate
from core.utils import iso, like, num, parse_uuid
from db import get_db
from models.admin import CooperativeApplication
from models.cooperative import Cooperative
from models.user import User
from schemas.auth import UserRole
from services import audit

router = APIRouter()
logger = logging.getLogger("milkflow.superadmin")


class ApplicationAction(BaseModel):
    action: Literal["APPROVE", "REJECT"]
    reason: Optional[str] = Field(default=None, max_length=500)


def require_reason(action: str, reason: Optional[str]) -> Optional[str]:
    cleaned = (reason or "").strip()
    if action == "REJECT" and len(cleaned) < 5:
        raise HTTPException(status_code=422, detail="Give a reason (at least 5 characters) when rejecting.")
    return cleaned or None


def applicant_account(db: Session, record: CooperativeApplication) -> Optional[User]:
    """The COOP_ADMIN user created at registration. Applications from before admin_user_id existed fall back to email."""
    if record.admin_user_id:
        return db.get(User, record.admin_user_id)
    return db.query(User).filter(User.email == record.email, User.role == UserRole.COOP_ADMIN).first()


def application_json(a: CooperativeApplication) -> dict:
    return {
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
        "estimated_daily_liters": num(a.estimated_daily_liters),
        "initial_coolers_count": a.initial_coolers_count,
        "additional_info": a.additional_info,
        "flags": a.flags or [],
        "rejection_reason": a.rejection_reason,
        "reviewed_at": iso(a.reviewed_at),
        "cooperative_id": str(a.cooperative_id) if a.cooperative_id else None,
    }


@router.get("/applications/pending")
def get_pending_applications(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    rows = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == "PENDING")
        .order_by(CooperativeApplication.created_at.asc())
        .all()
    )
    return [application_json(a) for a in rows]


@router.get("/applications")
def list_applications(
    application_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPROVED|REJECTED)$"),
    search: Optional[str] = Query(None, max_length=100),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = db.query(CooperativeApplication)
    if application_status:
        query = query.filter(CooperativeApplication.status == application_status)
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(
            CooperativeApplication.org_name.ilike(pattern, escape="\\")
            | CooperativeApplication.applicant_name.ilike(pattern, escape="\\")
            | CooperativeApplication.registration_number.ilike(pattern, escape="\\")
        )
    query = apply_sort(
        query, params.sort,
        {"created_at": CooperativeApplication.created_at, "org_name": CooperativeApplication.org_name},
        [CooperativeApplication.created_at.desc()],
    )
    return paginate(query, params, application_json)


@router.post("/applications/{app_id}/action")
def process_application_action(
    app_id: str,
    payload: ApplicationAction,
    db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
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
    # The explicit flushes put each row in place before anything points at it.
    try:
        if approved:
            cooperative = Cooperative(
                name=record.org_name,
                code=generate_cooperative_code(db, record.org_name),
                registration_number=record.registration_number,
                kra_pin=record.kra_pin,
                county=record.county,
                location=record.sub_county,
                contact_email=record.email,
                contact_phone=record.phone,
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
        record.reviewed_by = admin.user.id
        record.reviewed_at = datetime.utcnow()
        target = f"{record.org_name} ({cooperative.code})" if cooperative else record.org_name
        if cooperative:
            audit.record(
                db, admin, "COOPERATIVE_CREATED", target=f"{cooperative.name} ({cooperative.code}) from application",
                entity_type="cooperative", entity_id=cooperative.id, cooperative_id=cooperative.id,
                new_values={"name": cooperative.name, "code": cooperative.code},
            )
        audit.record(
            db, admin, "APPLICATION_APPROVED" if approved else "APPLICATION_REJECTED", target=target,
            entity_type="application", entity_id=record.id,
            cooperative_id=cooperative.id if cooperative else None,
            old_values={"status": "PENDING"}, new_values={"status": record.status}, reason=reason,
        )
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
