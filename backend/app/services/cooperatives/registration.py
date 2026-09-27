"""Cooperative onboarding: contact verification, application and review.

Tenant-isolation rules enforced here:
- Cooperative IDs are always generated server-side; clients never choose one.
- Submitting an application creates a PENDING cooperative with *no*
  memberships, so the applicant gets no tenant access before approval.
- Only a platform administrator's approval creates the applicant's
  COOPERATIVE_MANAGER membership, in the same transaction as the decision.
- OTP challenges are bound to the user who started them and are consumed by
  exactly one application.
"""

import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.request_context import RequestContext
from app.models.cooperative import (
    OPEN_APPLICATION_STATUSES,
    Cooperative,
    CooperativeApplication,
    CooperativeStatus,
)
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.registration import (
    RegistrationVerification,
    VerificationChannel,
    VerificationStatus,
)
from app.models.user import User
from app.schemas.cooperatives.registration import (
    ReviewApplicationRequest,
    StartVerificationRequest,
    SubmitApplicationRequest,
)
from app.security.otp import generate_otp, hash_otp, otp_matches
from app.services.audit import record_audit, record_security_event
from app.services.notifications.otp_delivery import deliver_otp

OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
# A verified phone must be used for an application within this window.
VERIFICATION_FRESHNESS = timedelta(minutes=30)

RATE_LIMIT_WINDOW = timedelta(minutes=10)
MAX_STARTS_PER_USER = 3
# Protects a phone/email owner from being flooded via many accounts.
MAX_STARTS_PER_DESTINATION = 3
MAX_STARTS_PER_IP = 10

_PHONE_SEPARATORS = re.compile(r"[\s\-().]")
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_CLOSED_STATUSES = (CooperativeStatus.APPROVED, CooperativeStatus.REJECTED)


def _now() -> datetime:
    return datetime.now(UTC)


def normalize_phone(raw: str) -> str:
    phone = _PHONE_SEPARATORS.sub("", raw)
    if not phone.startswith("+"):
        phone = f"+{phone}"
    if not _E164.match(phone):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Phone number must be in international format, e.g. +254712345678",
        )
    return phone


def normalize_destination(channel: VerificationChannel, raw: str) -> str:
    if channel is VerificationChannel.PHONE:
        return normalize_phone(raw)
    email = raw.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid email address"
        )
    return email


def normalize_cooperative_name(name: str) -> str:
    return " ".join(name.split()).casefold()


def _normalize_registration_number(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split()).upper()
    return value or None


def _too_many_requests() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many verification attempts. Try again later.",
    )


async def start_verification(
    db: AsyncSession,
    user: User,
    payload: StartVerificationRequest,
    ctx: RequestContext,
) -> tuple[RegistrationVerification, str | None]:
    """Create an OTP challenge. Returns the record and, in dev mode, the code."""
    settings = get_settings()
    destination = normalize_destination(payload.channel, payload.destination)
    now = _now()
    window_start = now - RATE_LIMIT_WINDOW

    # Serialize concurrent starts by the same user so the per-user limit holds.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    async def recent(*conditions) -> int:
        return await db.scalar(
            select(func.count())
            .select_from(RegistrationVerification)
            .where(RegistrationVerification.created_at >= window_start, *conditions)
        )

    if (
        await recent(RegistrationVerification.user_id == user.id) >= MAX_STARTS_PER_USER
        or await recent(RegistrationVerification.destination == destination)
        >= MAX_STARTS_PER_DESTINATION
        or await recent(RegistrationVerification.ip_address == ctx.ip_address)
        >= MAX_STARTS_PER_IP
    ):
        record_security_event(
            db,
            ctx,
            event="REGISTRATION_VERIFICATION_RATE_LIMITED",
            result="DENIED",
            user_id=user.id,
            metadata={"channel": payload.channel.value},
        )
        await db.commit()
        raise _too_many_requests()

    # Only the newest challenge per user and channel stays usable.
    await db.execute(
        update(RegistrationVerification)
        .where(
            RegistrationVerification.user_id == user.id,
            RegistrationVerification.channel == payload.channel,
            RegistrationVerification.status == VerificationStatus.PENDING,
        )
        .values(status=VerificationStatus.EXPIRED)
    )

    code = generate_otp()
    verification_id = uuid4()
    verification = RegistrationVerification(
        id=verification_id,
        user_id=user.id,
        channel=payload.channel,
        destination=destination,
        status=VerificationStatus.PENDING,
        code_hash=hash_otp(verification_id, code),
        attempts=0,
        expires_at=now + OTP_TTL,
        ip_address=ctx.ip_address,
    )
    db.add(verification)

    if not settings.expose_dev_otp:
        # Raises if no provider is configured; the rollback discards the record.
        await deliver_otp(payload.channel, destination, code)

    record_security_event(
        db,
        ctx,
        event="REGISTRATION_VERIFICATION_STARTED",
        result="SUCCESS",
        user_id=user.id,
        metadata={"channel": payload.channel.value, "verification_id": str(verification_id)},
    )
    await db.commit()

    return verification, code if settings.expose_dev_otp else None


async def confirm_verification(
    db: AsyncSession,
    user: User,
    verification_id: UUID,
    code: str,
    ctx: RequestContext,
) -> RegistrationVerification:
    # Scoped to the caller: another user's verification ID is simply "not found".
    verification = await db.scalar(
        select(RegistrationVerification)
        .where(
            RegistrationVerification.id == verification_id,
            RegistrationVerification.user_id == user.id,
        )
        .with_for_update()
    )
    if verification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Verification request not found"
        )

    if verification.status is not VerificationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification is no longer valid. Request a new code.",
        )

    now = _now()
    if verification.expires_at <= now:
        verification.status = VerificationStatus.EXPIRED
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification is no longer valid. Request a new code.",
        )

    if otp_matches(verification.id, code, verification.code_hash):
        verification.status = VerificationStatus.VERIFIED
        verification.verified_at = now
        if verification.channel is VerificationChannel.PHONE:
            user.phone = verification.destination
        record_security_event(
            db,
            ctx,
            event="REGISTRATION_CONTACT_VERIFIED",
            result="SUCCESS",
            user_id=user.id,
            metadata={
                "channel": verification.channel.value,
                "verification_id": str(verification.id),
            },
        )
        await db.commit()
        return verification

    verification.attempts += 1
    if verification.attempts >= OTP_MAX_ATTEMPTS:
        verification.status = VerificationStatus.LOCKED
    record_security_event(
        db,
        ctx,
        event="REGISTRATION_VERIFICATION_FAILED",
        result="FAILED",
        reason="INVALID_CODE",
        user_id=user.id,
        metadata={"verification_id": str(verification.id), "attempts": verification.attempts},
    )
    await db.commit()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification code")


async def submit_application(
    db: AsyncSession,
    user: User,
    payload: SubmitApplicationRequest,
    ctx: RequestContext,
) -> CooperativeApplication:
    phone = normalize_phone(payload.phone)
    now = _now()

    verification = await db.scalar(
        select(RegistrationVerification)
        .where(
            RegistrationVerification.id == payload.phone_verification_id,
            RegistrationVerification.user_id == user.id,
            RegistrationVerification.channel == VerificationChannel.PHONE,
        )
        .with_for_update()
    )
    if (
        verification is None
        or verification.status is not VerificationStatus.VERIFIED
        or verification.destination != phone
        or verification.verified_at is None
        or verification.verified_at < now - VERIFICATION_FRESHNESS
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify the phone number before submitting the application",
        )

    open_application = await db.scalar(
        select(CooperativeApplication.id).where(
            CooperativeApplication.applicant_user_id == user.id,
            CooperativeApplication.status.in_(OPEN_APPLICATION_STATUSES),
        )
    )
    if open_application is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an application awaiting review",
        )

    name_normalized = normalize_cooperative_name(payload.name)
    registration_number = _normalize_registration_number(payload.registration_number)

    duplicate_conditions = [Cooperative.name_normalized == name_normalized]
    if registration_number is not None:
        duplicate_conditions.append(Cooperative.registration_number == registration_number)
    duplicate = await db.scalar(select(Cooperative.id).where(or_(*duplicate_conditions)))
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A cooperative with these details already exists",
        )

    # The tenant is created PENDING and without memberships: nobody,
    # including the applicant, can access it until it is approved.
    cooperative = Cooperative(
        id=uuid4(),
        name=" ".join(payload.name.split()),
        name_normalized=name_normalized,
        registration_number=registration_number,
        status=CooperativeStatus.PENDING,
        currency="KES",
    )
    application = CooperativeApplication(
        id=uuid4(),
        cooperative_id=cooperative.id,
        applicant_user_id=user.id,
        status=CooperativeStatus.PENDING,
        reference=f"COOP-{now.year}-{secrets.token_hex(5).upper()}",
        contact_phone=phone,
        contact_email=payload.email.lower() if payload.email else None,
        location=payload.location or None,
        submitted_at=now,
    )
    verification.status = VerificationStatus.CONSUMED
    verification.consumed_at = now

    try:
        # Flushed explicitly, in FK order: the unit of work only orders inserts
        # along relationships, and audit rows reference the cooperative.
        db.add(cooperative)
        await db.flush()
        db.add(application)
        await db.flush()
    except IntegrityError as exc:
        # Lost a race against a concurrent submission. Nothing, including the
        # verification consumption, is persisted.
        await db.rollback()
        detail = _conflict_detail(exc)
        if detail is None:
            raise
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc

    record_audit(
        db,
        ctx,
        action="COOPERATIVE_APPLICATION_SUBMITTED",
        result="SUCCESS",
        actor_user_id=user.id,
        cooperative_id=cooperative.id,
        entity_type="CooperativeApplication",
        entity_id=application.id,
        metadata={"reference": application.reference},
    )
    await db.commit()

    return application


# Unique constraints that signal a lost race, mapped to the client message.
_CONFLICT_CONSTRAINTS = {
    "uq_cooperative_applications_open_per_applicant": (
        "You already have an application awaiting review"
    ),
    "cooperatives_name_normalized_key": "A cooperative with these details already exists",
    "cooperatives_registration_number_key": "A cooperative with these details already exists",
}


def _conflict_detail(exc: IntegrityError) -> str | None:
    message = str(exc.orig)
    for constraint, detail in _CONFLICT_CONSTRAINTS.items():
        if constraint in message:
            return detail
    return None


async def list_my_applications(
    db: AsyncSession, user: User
) -> list[tuple[CooperativeApplication, Cooperative]]:
    result = await db.execute(
        select(CooperativeApplication, Cooperative)
        .join(Cooperative, Cooperative.id == CooperativeApplication.cooperative_id)
        .where(CooperativeApplication.applicant_user_id == user.id)
        .order_by(CooperativeApplication.submitted_at.desc())
    )
    return list(result.tuples())


async def get_my_application(
    db: AsyncSession, user: User, reference: str
) -> tuple[CooperativeApplication, Cooperative]:
    # Scoped to the applicant: someone else's reference is indistinguishable
    # from one that does not exist.
    row = (
        await db.execute(
            select(CooperativeApplication, Cooperative)
            .join(Cooperative, Cooperative.id == CooperativeApplication.cooperative_id)
            .where(
                CooperativeApplication.reference == reference,
                CooperativeApplication.applicant_user_id == user.id,
            )
        )
    ).tuples().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return row


async def list_applications(
    db: AsyncSession,
    status_filter: CooperativeStatus | None,
    limit: int,
    offset: int,
) -> list[tuple[CooperativeApplication, Cooperative]]:
    query = select(CooperativeApplication, Cooperative).join(
        Cooperative, Cooperative.id == CooperativeApplication.cooperative_id
    )
    if status_filter is not None:
        query = query.where(CooperativeApplication.status == status_filter)
    result = await db.execute(
        query.order_by(CooperativeApplication.submitted_at.desc()).limit(limit).offset(offset)
    )
    return list(result.tuples())


async def review_application(
    db: AsyncSession,
    reviewer: User,
    application_id: UUID,
    payload: ReviewApplicationRequest,
    ctx: RequestContext,
) -> tuple[CooperativeApplication, Cooperative]:
    # Row locks make concurrent reviews of one application strictly ordered,
    # so a decision can never be applied twice or on top of a closed one.
    application = await db.scalar(
        select(CooperativeApplication)
        .where(CooperativeApplication.id == application_id)
        .with_for_update()
    )
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if application.status in _CLOSED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Application is already closed"
        )

    if application.applicant_user_id == reviewer.id:
        record_security_event(
            db,
            ctx,
            event="COOPERATIVE_APPLICATION_SELF_REVIEW",
            result="DENIED",
            user_id=reviewer.id,
            cooperative_id=application.cooperative_id,
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewers cannot decide their own application",
        )

    cooperative = await db.scalar(
        select(Cooperative).where(Cooperative.id == application.cooperative_id).with_for_update()
    )
    decision = CooperativeStatus(payload.status)
    before_state = {"status": application.status.value}
    now = _now()

    application.status = decision
    application.notes = payload.notes
    application.requested_information = (
        payload.notes if decision is CooperativeStatus.MORE_INFORMATION_REQUIRED else None
    )
    application.reviewed_at = now
    application.reviewed_by_user_id = reviewer.id
    cooperative.status = decision

    if decision is CooperativeStatus.APPROVED:
        # The first and only way a user becomes a tenant member at onboarding:
        # the applicant's User.id (never a client-supplied value).
        await db.execute(
            insert(Membership)
            .values(
                id=uuid4(),
                user_id=application.applicant_user_id,
                cooperative_id=application.cooperative_id,
                role=MembershipRole.COOPERATIVE_MANAGER,
                status=MembershipStatus.ACTIVE,
            )
            .on_conflict_do_nothing(constraint="uq_memberships_user_coop_role")
        )

    record_audit(
        db,
        ctx,
        action=f"COOPERATIVE_APPLICATION_{decision.value}",
        result="SUCCESS",
        actor_user_id=reviewer.id,
        cooperative_id=application.cooperative_id,
        entity_type="CooperativeApplication",
        entity_id=application.id,
        before_state=before_state,
        after_state={"status": decision.value},
        metadata={"notes": payload.notes} if payload.notes else None,
    )
    await db.commit()

    return application, cooperative
