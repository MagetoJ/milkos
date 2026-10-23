"""Cooperative onboarding applications: the review queue and approve/reject decisions."""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.utils import iso, like, num, parse_uuid
from app.domain.exceptions import Conflict, NotFound, OperationFailed, ValidationFailed
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.admin import CooperativeApplication
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.user import AccountStatus, User
from app.infrastructure.db.pagination import PageParams, apply_sort, paginate
from app.services import audit
from app.services.applicant_notifications import notify_applicant
from app.services.onboarding import generate_cooperative_code
from app.services.principal import Principal

logger = logging.getLogger("milkflow.superadmin")


def require_reason(action: str, reason: Optional[str]) -> Optional[str]:
    cleaned = (reason or "").strip()
    if action == "REJECT" and len(cleaned) < 5:
        raise ValidationFailed("Give a reason (at least 5 characters) when rejecting.")
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


def pending(db: Session) -> list[dict]:
    rows = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == "PENDING")
        .order_by(CooperativeApplication.created_at.asc())
        .all()
    )
    return [application_json(a) for a in rows]


def list_page(db: Session, status: Optional[str], search: Optional[str], params: PageParams) -> dict:
    query = db.query(CooperativeApplication)
    if status:
        query = query.filter(CooperativeApplication.status == status)
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


def decide(db: Session, admin: Principal, app_id: str, action: str, reason: Optional[str]) -> tuple[CooperativeApplication, Optional[Cooperative]]:
    """Approve (creates the cooperative and activates its admin) or reject (frees the applicant's details). Commits,
    then tells the applicant."""
    reason = require_reason(action, reason)
    # Row lock (Postgres) so two superadmins deciding at once are serialised.
    record = db.get(CooperativeApplication, parse_uuid(app_id, "Application"), with_for_update=True)
    if not record:
        raise NotFound("Application")
    if record.status != "PENDING":
        raise Conflict(f"This application was already {record.status.lower()}.")

    approved = action == "APPROVE"
    applicant = applicant_account(db, record)
    cooperative = None

    if approved:
        if not (record.registration_number and record.kra_pin and record.county):
            raise ValidationFailed(
                "This application is missing its registration number, KRA PIN or county. "
                "Reject it and ask the applicant to apply again."
            )
        if not applicant:
            raise Conflict("The applicant's account no longer exists. Reject this application and ask them to apply again.")

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
            applicant.set_status(AccountStatus.ACTIVE)
            applicant.activated_at = datetime.utcnow()
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
        raise Conflict("A cooperative with this registration number or KRA PIN already exists. Reject this application.")
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Saving the decision on application %s failed", app_id)
        raise OperationFailed("Could not save the decision. Try again.")

    notify_applicant(record, "APPLICATION_APPROVED" if approved else "APPLICATION_REJECTED")
    return record, cooperative
