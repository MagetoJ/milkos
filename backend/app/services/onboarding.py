"""
Cooperative applications: submission, issue detection and the applicant's status check.

- `find_conflict` returns the first hard block (the request is refused with 409).
- `detect_flags` returns soft warnings, which are saved on the application for the superadmin.
"""
import logging
import re
import secrets
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import constant_time_equals, hash_password
from app.core.utils import conflict
from app.core.validation import name_key, names_similar
from app.domain.exceptions import NotFound, OperationFailed, ServiceUnavailable
from app.domain.schemas.auth import CooperativeRegisterRequest, UserRole
from app.infrastructure.db.models.admin import CooperativeApplication
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.user import AccountStatus, User
from app.services import inbox, settings
from app.services.applicant_notifications import notify_applicant

logger = logging.getLogger("milkflow.auth")

PENDING, APPROVED, REJECTED = "PENDING", "APPROVED", "REJECTED"


def _account_conflict(db: Session, user: User, what: str) -> str:
    if user.is_active:
        if user.role in (UserRole.FARMER, UserRole.COLLECTOR):
            role = "farmer" if user.role == UserRole.FARMER else "collector"
            return f"This {what} is already registered to a {role} account. Use a different {what} or contact support."
        return f"An account with this {what} already exists. Sign in instead."
    pending = (
        db.query(CooperativeApplication.id)
        .filter(CooperativeApplication.status == PENDING)
        .filter(or_(CooperativeApplication.admin_user_id == user.id, CooperativeApplication.email == user.email))
        .first()
    )
    if pending:
        return f"An application using this {what} is already awaiting review."
    return f"This {what} belongs to an inactive account. Contact support."


def find_conflict(db: Session, data: CooperativeRegisterRequest) -> Optional[tuple[str, str]]:
    """(field, message) for the first reason this application must be refused, else None."""
    coop = (
        db.query(Cooperative)
        .filter(or_(Cooperative.registration_number == data.registration_number, Cooperative.kra_pin == data.kra_pin))
        .first()
    )
    if coop:
        if coop.registration_number == data.registration_number:
            return "registration_number", "This registration number already belongs to a registered cooperative."
        return "kra_pin", "This KRA PIN already belongs to a registered cooperative."

    pending = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == PENDING)
        .filter(or_(
            CooperativeApplication.registration_number == data.registration_number,
            CooperativeApplication.kra_pin == data.kra_pin,
        ))
        .first()
    )
    if pending:
        if pending.registration_number == data.registration_number:
            return "registration_number", "An application with this registration number is already awaiting review."
        return "kra_pin", "An application with this KRA PIN is already awaiting review."

    user = db.query(User).filter(User.email == data.admin_email).first()
    if user:
        return "admin_email", _account_conflict(db, user, "email address")
    user = db.query(User).filter(User.phone_number == data.admin_phone).first()
    if user:
        return "admin_phone", _account_conflict(db, user, "phone number")
    return None


def _flag(code: str, message: str) -> dict:
    return {"code": code, "message": message[:500]}


def detect_flags(db: Session, data: CooperativeRegisterRequest) -> list[dict]:
    flags: list[dict] = []

    # Similar names among registered co-ops and applications still in play.
    seen: set[str] = set()
    for (name,) in db.query(Cooperative.name).all():
        if names_similar(data.cooperative_name, name) and name_key(name) not in seen:
            seen.add(name_key(name))
            flags.append(_flag("SIMILAR_NAME", f'Name is similar to the registered cooperative "{name}".'))
    open_apps = (
        db.query(CooperativeApplication.org_name, CooperativeApplication.status)
        .filter(CooperativeApplication.status.in_([PENDING, APPROVED]))
        .all()
    )
    for name, status in open_apps:
        if names_similar(data.cooperative_name, name) and name_key(name) not in seen:
            seen.add(name_key(name))
            state = "awaiting review" if status == PENDING else "approved"
            flags.append(_flag("SIMILAR_NAME", f'Name is similar to "{name}", whose application is {state}.'))

    # Same phone / ID number on another live application. Rejected ones are reported below.
    others = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status != REJECTED)
        .filter(or_(
            CooperativeApplication.phone == data.admin_phone,
            CooperativeApplication.admin_id_number == data.admin_id_number,
        ))
        .all()
    )
    for other in others:
        state = (other.status or PENDING).lower()
        if other.phone == data.admin_phone:
            flags.append(_flag("SHARED_PHONE", f'The admin phone is also on the {state} application for "{other.org_name}".'))
        if other.admin_id_number == data.admin_id_number:
            flags.append(_flag("SHARED_ID_NUMBER", f'The admin ID number is also on the {state} application for "{other.org_name}".'))

    rejected = (
        db.query(CooperativeApplication)
        .filter(CooperativeApplication.status == REJECTED)
        .filter(or_(
            CooperativeApplication.email == data.admin_email,
            CooperativeApplication.phone == data.admin_phone,
            CooperativeApplication.admin_id_number == data.admin_id_number,
            CooperativeApplication.registration_number == data.registration_number,
            CooperativeApplication.kra_pin == data.kra_pin,
        ))
        .order_by(CooperativeApplication.reviewed_at.desc())
        .all()
    )
    if rejected:
        last = rejected[0]
        when = last.reviewed_at.strftime("%d %b %Y") if last.reviewed_at else "an earlier date"
        reason = f': "{last.rejection_reason}"' if last.rejection_reason else ""
        times = "" if len(rejected) == 1 else f" ({len(rejected)} earlier rejections)"
        flags.append(_flag(
            "PREVIOUSLY_REJECTED",
            f'Re-application. "{last.org_name}" was rejected on {when}{reason}{times}.',
        ))
    return flags


def generate_cooperative_code(db: Session, name: str) -> str:
    """Readable unique code such as LIMURU-4F2A."""
    words = name_key(name).split()
    base = re.sub(r"[^A-Z0-9]", "", (words[0] if words else "COOP").upper())[:10] or "COOP"
    for _ in range(20):
        code = f"{base}-{secrets.token_hex(2).upper()}"
        if not db.query(Cooperative.id).filter(Cooperative.code == code).first():
            return code
    return f"{base}-{secrets.token_hex(6).upper()}"


def submit_application(db: Session, payload: CooperativeRegisterRequest) -> CooperativeApplication:
    """Save a public application with its (inactive) COOP_ADMIN account, pending superadmin approval. Commits.

    Individual roles (managers, collectors, farmers) never self-register: the cooperative admin creates them.
    """
    if not settings.get(db, "onboarding.accepting_applications"):
        raise ServiceUnavailable("Milkflow is not accepting new cooperative applications right now. Please try again later.")
    # The payload is already normalised (phone in E.164, uppercase KRA PIN, canonical county...).
    clash = find_conflict(db, payload)
    if clash:
        raise conflict(*clash)
    flags = detect_flags(db, payload)

    try:
        admin = User(
            email=payload.admin_email,
            password_hash=hash_password(payload.password),
            full_name=payload.admin_full_name,
            phone_number=payload.admin_phone,
            role=UserRole.COOP_ADMIN,
            password_set_at=datetime.utcnow(),
        )
        # Unable to sign in until a superadmin approves the application.
        admin.set_status(AccountStatus.PENDING_APPROVAL)
        db.add(admin)
        db.flush()

        application = CooperativeApplication(
            org_name=payload.cooperative_name,
            applicant_name=payload.admin_full_name,
            email=payload.admin_email,
            phone=payload.admin_phone,
            location=f"{payload.location}, {payload.county}",
            status=PENDING,
            registration_number=payload.registration_number,
            kra_pin=payload.kra_pin,
            county=payload.county,
            sub_county=payload.location,
            admin_id_number=payload.admin_id_number,
            estimated_daily_liters=payload.estimated_daily_liters,
            initial_coolers_count=payload.initial_coolers_count,
            additional_info=payload.additional_info,
            admin_user_id=admin.id,
            flags=flags,
        )
        db.add(application)
        db.flush()
        inbox.platform(
            db, category="SYSTEM", type="APPLICATION_SUBMITTED", title=f"New cooperative application: {payload.cooperative_name}",
            body=f"{payload.admin_full_name}, {payload.county}" + (f" ({len(flags)} flag(s) to check)" if flags else ""),
            severity="WARNING" if flags else "INFO", entity_type="application", entity_id=application.id,
            link="/superadmin/onboarding",
        )
        db.commit()
    except IntegrityError:
        # A simultaneous submission won the race for a unique value (email, phone, reg. no., KRA PIN).
        db.rollback()
        raise conflict(*(find_conflict(db, payload) or (
            None, "An application with these details was just submitted. Refresh and check before trying again."
        )))
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Cooperative registration failed")
        raise OperationFailed("We couldn't save your application. Please try again in a few minutes.")

    notify_applicant(application, "APPLICATION_RECEIVED")
    return application


def application_status(db: Session, reference: str, email: str) -> dict:
    """An applicant checks their application with its reference AND the email they applied with. A wrong pair
    gets the same 'not found' as a missing one; only the status is returned."""
    no_match = NotFound("Application", "No application matches this reference and email.")
    try:
        application_id = UUID(reference.strip())
    except ValueError:
        raise no_match
    record = db.get(CooperativeApplication, application_id)
    if record is None or not constant_time_equals((record.email or "").lower(), email.strip().lower()):
        raise no_match
    return {
        "status": record.status,
        "organisation": record.org_name,
        "submitted_at": record.created_at.isoformat() + "Z" if record.created_at else None,
        "reviewed_at": record.reviewed_at.isoformat() + "Z" if record.reviewed_at else None,
        "rejection_reason": record.rejection_reason if record.status == REJECTED else None,
    }
