"""Account lifecycle: invitation, SMS activation, phone verification, password reset and account status.

    ADMIN CREATES ACCOUNT ─> PENDING_ACTIVATION (no password) ─> one-time activation link by SMS
        ─> person opens the link ─> (code sent to the phone, entered) ─> sets their own password ─> ACTIVE

Rules enforced here (never by the UI):
- An administrator never sets, sees or receives anyone's password. Accounts start without one; the person
  creates it from the activation link. An administrator who needs to help someone back in sends a password
  RESET link (or a new activation link, for an account that was never activated).
- Activation tokens and reset tokens are separate tables and separate flows. Both are random 256-bit values that
  exist only inside the SMS; the database keeps a SHA-256 hash. They expire, work once, and issuing a new one
  revokes every older open one. Links put the token in the URL fragment (#t=...), which browsers never send to a
  server, so it can't land in access logs.
- SMS codes are 6 digits, stored as a keyed hash bound to their challenge, expire after OTP_MINUTES, allow
  OTP_MAX_ATTEMPTS wrong guesses, and can be resent only after OTP_RESEND_SECONDS (at most OTP_MAX_SENDS times).
- SMS go through services.notifications (the existing provider + SMS credit ledger). The stored message has the
  link or code replaced, and a failed one is never auto-retried: a new link or code is issued instead.
- Public endpoints never reveal whether an account exists (generic answers).

Billing: messages about a cooperative's account are charged to that cooperative's SMS credits, except when platform
staff triggered them (or the account has no cooperative): those are billed to the platform.
"""
from __future__ import annotations

import datetime
import logging
import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.security import generate_otp, generate_token, hash_otp, hash_password, hash_token, verify_password
from core.validation import mask_phone_local, normalize_email, normalize_phone
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from models.sync import DeviceSession
from models.user import AccountActivation, AccountStatus, OtpPurpose, PasswordReset, PhoneVerification, User
from schemas.auth import UserRole
from services import notifications, security_events, settings

logger = logging.getLogger("milkflow.accounts")

APP_URL = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
ACTIVATION_PATH = "/activate-account"
RESET_PATH = "/reset-password"

OTP_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_SECONDS = 60
OTP_MAX_SENDS = 5
ADMIN_RESEND_SECONDS = 60
PUBLIC_RESEND_SECONDS = 120
PUBLIC_MAX_PER_HOUR = 5
LOCKOUT_THRESHOLD = 5
LOCKOUT_MINUTES = 15

GENERIC_RESEND = "If the account exists and can receive messages, a new link will be sent to its phone."
GENERIC_RESET = "If an active account matches, a password reset link will be sent to its phone."


def now() -> datetime.datetime:
    return datetime.datetime.utcnow()


@dataclass
class PendingSms:
    """An SMS created inside a transaction, sent after it commits (with its real text, which is never stored)."""
    notification_id: UUID
    text: str
    user_id: UUID
    kind: str  # ACTIVATION / OTP / RESET / NOTICE


# ---------------- reading state ----------------

def find_by_identifier(db: Session, identifier: str) -> Optional[User]:
    """An account by email or phone number (any accepted format); None when it doesn't parse or doesn't exist."""
    value = (identifier or "").strip()
    if not value:
        return None
    if "@" in value:
        return db.query(User).filter(User.email == normalize_email(value)).first()
    try:
        phone = normalize_phone(value)
    except ValueError:
        return None
    return db.query(User).filter(User.phone_number == phone).first()


def open_activation(db: Session, user_id: UUID) -> Optional[AccountActivation]:
    return (
        db.query(AccountActivation)
        .filter(AccountActivation.user_id == user_id, AccountActivation.used_at.is_(None), AccountActivation.revoked_at.is_(None))
        .order_by(AccountActivation.created_at.desc())
        .first()
    )


def activation_summary(db: Session, user: User) -> Optional[dict]:
    """What an administrator sees about a pending account (never the token)."""
    if user.status_value != AccountStatus.PENDING_ACTIVATION:
        return None
    latest = (
        db.query(AccountActivation).filter(AccountActivation.user_id == user.id)
        .order_by(AccountActivation.created_at.desc()).first()
    )
    sms = db.get(Notification, latest.notification_id) if latest and latest.notification_id else None
    expired = bool(latest and latest.expires_at < now())
    return {
        "invited_at": _iso(user.invited_at),
        "link_sent_at": _iso(latest.created_at) if latest else None,
        "link_expires_at": _iso(latest.expires_at) if latest else None,
        "link_state": (
            "NONE" if latest is None else "REVOKED" if latest.revoked_at else "USED" if latest.used_at
            else "EXPIRED" if expired else "OPENED" if latest.opened_at else "SENT"
        ),
        "sms_status": (
            "EXPIRED" if expired and sms is not None and sms.status in (NotificationStatus.SENT, NotificationStatus.DELIVERED)
            else sms.status if sms else None
        ),
        "sms_error": sms.error if sms else None,
        "last_sms_attempt_at": _iso((sms.sent_at or sms.failed_at or sms.created_at)) if sms else None,
        "phone_verified": user.phone_verified_at is not None,
    }


def _iso(value):
    from core.utils import iso

    return iso(value)


# ---------------- SMS ----------------

def _billing(user: User, actor: Optional[User]) -> tuple[Optional[UUID], str]:
    if user.cooperative_id is None:
        return None, "PLATFORM"
    if actor is not None and actor.role_value == UserRole.SUPER_ADMIN.value:
        return user.cooperative_id, "PLATFORM"
    return user.cooperative_id, "COOPERATIVE"


def _queue_sms(db: Session, user: User, *, kind: str, ntype: str, text: str, stored: str, phone: Optional[str] = None,
               actor: Optional[User] = None, severity: str = "INFO") -> PendingSms:
    cooperative_id, billed_to = _billing(user, actor)
    n = Notification(
        cooperative_id=cooperative_id, billed_to=billed_to, recipient_user_id=user.id,
        recipient_phone=phone or user.phone_number, channel="SMS", type=ntype, severity=severity,
        message=stored, context={"purpose": kind.lower()}, status=NotificationStatus.PENDING,
    )
    db.add(n)
    db.flush()
    return PendingSms(notification_id=n.id, text=text, user_id=user.id, kind=kind)


def dispatch(db: Session, pending: Optional[PendingSms], *, ip: Optional[str] = None, ua: Optional[str] = None) -> Optional[Notification]:
    """Send a queued SMS (call after the transaction that queued it has committed). Records the outcome."""
    if pending is None:
        return None
    n = db.get(Notification, pending.notification_id)
    if n is None:
        return None
    try:
        n = notifications.deliver(db, n, text=pending.text)
    except Exception:  # an SMS problem must never fail the request that caused it
        db.rollback()
        logger.exception("security_sms_failed notification=%s kind=%s", pending.notification_id, pending.kind)
        n = db.get(Notification, pending.notification_id)
    sent = n is not None and n.status in (NotificationStatus.SENT, NotificationStatus.DELIVERED)
    if pending.kind == "ACTIVATION":
        user = db.get(User, pending.user_id)
        security_events.record(
            db, "ACTIVATION_SMS_SENT" if sent else "ACTIVATION_SMS_FAILED", user=user, actor=None, ip_address=ip,
            user_agent=ua, details={"sms_status": n.status if n else "MISSING", "error": n.error if n and not sent else None},
        )
        db.commit()
    return n


def sms_outcome(n: Optional[Notification]) -> dict:
    """What a caller may be told about a security SMS: whether the provider accepted it (never 'delivered' unless
    a delivery report said so)."""
    if n is None:
        return {"sms_status": "FAILED", "sms_sent": False, "sms_error": "The message could not be created."}
    sent = n.status in (NotificationStatus.SENT, NotificationStatus.DELIVERED)
    return {"sms_status": n.status, "sms_sent": sent, "sms_error": None if sent else n.error}


# ---------------- invitation & activation ----------------

def _activation_minutes(db: Session) -> int:
    return int(settings.get(db, "security.activation_link_minutes") or 30)


def _revoke_activations(db: Session, user_id: UUID, reason: str) -> None:
    stamp = now()
    for row in db.query(AccountActivation).filter(
        AccountActivation.user_id == user_id, AccountActivation.used_at.is_(None), AccountActivation.revoked_at.is_(None)
    ):
        row.revoked_at = stamp
        row.revoked_reason = reason
    for otp in db.query(PhoneVerification).filter(
        PhoneVerification.user_id == user_id, PhoneVerification.purpose == OtpPurpose.ACTIVATION,
        PhoneVerification.verified_at.is_(None), PhoneVerification.revoked_at.is_(None),
    ):
        otp.revoked_at = stamp


def _issue_activation(db: Session, user: User, actor: Optional[User], reason: str) -> PendingSms:
    _revoke_activations(db, user.id, reason)
    token = generate_token()
    minutes = _activation_minutes(db)
    activation = AccountActivation(
        user_id=user.id, token_hash=hash_token(token), created_by=actor.id if actor else None,
        created_at=now(), expires_at=now() + datetime.timedelta(minutes=minutes),
    )
    db.add(activation)
    db.flush()
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    account = mask_phone_local(user.phone_number).replace("•", "X")
    expiry = f"{minutes} minutes" if minutes < 120 else f"{minutes // 60} hours"
    head = f"Welcome to MilkOS. Your {coop.name + ' ' if coop else ''}account has been created. Account: {account}."
    text = f"{head} Activate it here: {APP_URL}{ACTIVATION_PATH}#t={token} . This link expires in {expiry}."
    stored = f"{head} Activate it here: [one-time link hidden] . This link expires in {expiry}."
    pending = _queue_sms(db, user, kind="ACTIVATION", ntype="ACCOUNT_ACTIVATION", text=text, stored=stored, actor=actor)
    activation.notification_id = pending.notification_id
    return pending


def new_pending_user(*, full_name: str, phone: str, role: UserRole, email: Optional[str] = None,
                     cooperative_id: Optional[UUID] = None, invited_by: Optional[UUID] = None) -> User:
    """A User row in PENDING_ACTIVATION with no password (the person sets it when activating)."""
    user = User(
        email=email or None, password_hash=None, full_name=full_name, phone_number=phone, role=role,
        cooperative_id=cooperative_id, invited_at=now(), invited_by=invited_by,
    )
    user.set_status(AccountStatus.PENDING_ACTIVATION)
    user.session_epoch = 0
    return user


def invite(db: Session, principal, user: User) -> PendingSms:
    """Record the invitation of a freshly created (flushed) pending account and queue its activation SMS.
    Doesn't commit; call dispatch() with the result after committing."""
    security_events.from_principal(db, principal, "ACCOUNT_CREATED", user=user, details={"role": user.role_value})
    security_events.from_principal(db, principal, "ACTIVATION_SMS_REQUESTED", user=user)
    return _issue_activation(db, user, principal.user, "superseded")


def _guard_admin_target(principal, user: User) -> None:
    """Who may manage whose account: platform staff anyone (except themselves); a cooperative admin only the
    managers, collectors and farmers of their own cooperative."""
    if user.id == principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't do this to your own account.")
    if principal.is_superadmin:
        return
    if principal.role != UserRole.COOP_ADMIN.value or user.cooperative_id != principal.cooperative_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if user.role_value in (UserRole.SUPER_ADMIN.value, UserRole.COOP_ADMIN.value):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only platform staff can manage administrator accounts.")


def resend_activation(db: Session, principal, user: User) -> PendingSms:
    _guard_admin_target(principal, user)
    if user.status_value != AccountStatus.PENDING_ACTIVATION:
        raise HTTPException(status.HTTP_409_CONFLICT, "This account is not waiting for activation.")
    latest = open_activation(db, user.id)
    if latest is not None and (now() - latest.created_at).total_seconds() < ADMIN_RESEND_SECONDS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "An activation link was just sent. Wait a minute before sending another.")
    security_events.from_principal(db, principal, "ACTIVATION_RESENT", user=user)
    pending = _issue_activation(db, user, principal.user, "resent")
    db.commit()
    return pending


def revoke_invitation(db: Session, principal, user: User, reason: Optional[str]) -> User:
    _guard_admin_target(principal, user)
    if user.status_value != AccountStatus.PENDING_ACTIVATION:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only an invitation that hasn't been accepted can be revoked.")
    _revoke_activations(db, user.id, "revoked")
    user.set_status(AccountStatus.DISABLED, reason or "Invitation revoked")
    security_events.from_principal(db, principal, "ACTIVATION_REVOKED", user=user, details={"reason": reason})
    db.commit()
    return user


def _token_row(db: Session, model, token: str):
    if not token or len(token) > 200:
        return None
    return db.query(model).filter(model.token_hash == hash_token(token)).first()


def _token_state(row, *, used_attr: str = "used_at") -> str:
    if row is None:
        return "INVALID"
    if row.revoked_at is not None:
        return "REVOKED"
    if getattr(row, used_attr) is not None:
        return "USED"
    if row.expires_at < now():
        return "EXPIRED"
    return "VALID"


def requires_otp(db: Session) -> bool:
    return bool(settings.get(db, "security.activation_requires_otp"))


def inspect_activation(db: Session, token: str, *, ip: Optional[str] = None, ua: Optional[str] = None) -> dict:
    """The activation page's view of a token. Account details only for a VALID token; otherwise just the state."""
    row = _token_row(db, AccountActivation, token)
    state = _token_state(row)
    user = db.get(User, row.user_id) if row is not None else None
    if state == "VALID" and (user is None or user.status_value != AccountStatus.PENDING_ACTIVATION):
        state = "USED" if user is not None and user.status_value == AccountStatus.ACTIVE else "REVOKED"
    if state != "VALID":
        return {"state": state, "can_request_new_link": state == "EXPIRED"}
    if row.opened_at is None:
        row.opened_at = now()
        security_events.record(db, "ACTIVATION_LINK_OPENED", user=user, ip_address=ip, user_agent=ua)
        db.commit()
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    otp_needed = requires_otp(db)
    return {
        "state": "VALID",
        "full_name": user.full_name,
        "role": user.role_value,
        "cooperative_name": coop.name if coop else None,
        "phone_masked": mask_phone_local(user.phone_number),
        "expires_at": _iso(row.expires_at),
        "requires_otp": otp_needed,
        "otp_verified": row.otp_verified_at is not None,
        "can_request_new_link": False,
    }


def _valid_activation(db: Session, token: str) -> tuple[AccountActivation, User]:
    row = _token_row(db, AccountActivation, token)
    state = _token_state(row)
    user = db.get(User, row.user_id) if row is not None else None
    if state != "VALID" or user is None or user.status_value != AccountStatus.PENDING_ACTIVATION:
        messages = {
            "EXPIRED": "This activation link has expired. Request a new one.",
            "USED": "This activation link has already been used. Sign in instead.",
            "REVOKED": "This activation link is no longer valid. Request a new one or contact your administrator.",
        }
        raise HTTPException(status.HTTP_410_GONE, messages.get(state, "This activation link is not valid."))
    return row, user


# ---------------- one-time codes ----------------

def _send_otp(db: Session, user: User, purpose: str, phone: str, *, activation_id: Optional[UUID] = None,
              requested_by: Optional[User] = None, billed_as: Optional[User] = None) -> tuple[PhoneVerification, PendingSms]:
    """Create (or resend) the code for `purpose`, honouring the resend cooldown and send limit."""
    stamp = now()
    query = db.query(PhoneVerification).filter(
        PhoneVerification.user_id == user.id, PhoneVerification.purpose == purpose,
        PhoneVerification.verified_at.is_(None), PhoneVerification.revoked_at.is_(None),
    )
    current = query.order_by(PhoneVerification.created_at.desc()).first()
    if current is not None and current.phone == phone and current.activation_id == activation_id and current.expires_at > stamp:
        wait = OTP_RESEND_SECONDS - (stamp - current.last_sent_at).total_seconds()
        if wait > 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"A code was just sent. You can request another in {int(wait) + 1} seconds.")
        if current.send_count >= OTP_MAX_SENDS:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many codes requested. Wait for this one to expire and start again.")
    for row in query:
        row.revoked_at = stamp
    code = generate_otp()
    otp = PhoneVerification(
        user_id=user.id, purpose=purpose, phone=phone, activation_id=activation_id, code_hash="pending",
        created_at=stamp, expires_at=stamp + datetime.timedelta(minutes=OTP_MINUTES), last_sent_at=stamp,
        send_count=(current.send_count + 1) if current is not None and current.phone == phone else 1,
        requested_by=requested_by.id if requested_by else None,
    )
    db.add(otp)
    db.flush()
    otp.code_hash = hash_otp(code, str(otp.id))
    text = f"MilkOS verification code: {code}. It expires in {OTP_MINUTES} minutes. Never share this code with anyone."
    stored = f"MilkOS verification code: ******. It expires in {OTP_MINUTES} minutes. Never share this code with anyone."
    pending = _queue_sms(db, user, kind="OTP", ntype="PHONE_OTP", text=text, stored=stored, phone=phone, actor=billed_as or requested_by)
    otp.notification_id = pending.notification_id
    return otp, pending


def _check_otp(db: Session, otp: Optional[PhoneVerification], code: str, user: User, ip=None, ua=None) -> None:
    """Verify `code` against `otp`, counting the attempt. Raises with a safe message on failure (and commits the
    attempt count, so guesses can't be retried for free)."""
    stamp = now()
    if otp is None or otp.revoked_at is not None or otp.verified_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Request a new code.")
    if otp.expires_at < stamp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This code has expired. Request a new one.")
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong codes. Request a new one.")
    otp.attempts += 1
    from core.security import constant_time_equals

    if not code or not code.strip().isdigit() or not constant_time_equals(hash_otp(code.strip(), str(otp.id)), otp.code_hash):
        left = OTP_MAX_ATTEMPTS - otp.attempts
        if left <= 0:
            otp.revoked_at = stamp
        security_events.record(db, "OTP_FAILED", user=user, ip_address=ip, user_agent=ua, details={"purpose": otp.purpose})
        db.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That code is not right. {left} attempt{'s' if left != 1 else ''} left." if left > 0 else "Too many wrong codes. Request a new one.",
        )
    otp.verified_at = stamp
    security_events.record(db, "OTP_VERIFIED", user=user, ip_address=ip, user_agent=ua, details={"purpose": otp.purpose})


def activation_send_otp(db: Session, token: str, *, ip=None, ua=None) -> tuple[PendingSms, PhoneVerification]:
    row, user = _valid_activation(db, token)
    # The code is billed like the invitation it belongs to (platform staff's invitations are platform-billed).
    inviter = db.get(User, row.created_by) if row.created_by else None
    otp, pending = _send_otp(db, user, OtpPurpose.ACTIVATION, user.phone_number, activation_id=row.id, billed_as=inviter)
    security_events.record(db, "OTP_REQUESTED", user=user, ip_address=ip, user_agent=ua, details={"purpose": "ACTIVATION"})
    db.commit()
    return pending, otp


def activation_verify_otp(db: Session, token: str, code: str, *, ip=None, ua=None) -> None:
    row, user = _valid_activation(db, token)
    otp = (
        db.query(PhoneVerification)
        .filter(PhoneVerification.activation_id == row.id, PhoneVerification.revoked_at.is_(None))
        .order_by(PhoneVerification.created_at.desc()).first()
    )
    _check_otp(db, otp, code, user, ip, ua)
    row.otp_verified_at = now()
    user.phone_verified_at = now()
    db.commit()


def complete_activation(db: Session, token: str, password: str, *, ip=None, ua=None) -> User:
    row, user = _valid_activation(db, token)
    if requires_otp(db) and row.otp_verified_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirm your phone number with the code we send you first.")
    stamp = now()
    user.password_hash = hash_password(password)
    user.password_set_at = stamp
    user.must_change_password = False
    # The link reached this phone by SMS, so opening it proves the number even when no code was required.
    user.phone_verified_at = user.phone_verified_at or stamp
    user.activated_at = stamp
    user.failed_login_count = 0
    user.locked_until = None
    user.set_status(AccountStatus.ACTIVE)
    _revoke_activations(db, user.id, "activated")  # every OTHER open link (this one is marked used below)
    row.revoked_at = None
    row.revoked_reason = None
    row.used_at = stamp
    security_events.record(db, "PASSWORD_CREATED", user=user, ip_address=ip, user_agent=ua)
    security_events.record(db, "ACTIVATION_COMPLETED", user=user, ip_address=ip, user_agent=ua)
    db.commit()
    db.refresh(user)
    return user


def public_resend_activation(db: Session, *, token: Optional[str] = None, identifier: Optional[str] = None,
                             ip=None, ua=None) -> Optional[PendingSms]:
    """Self-service 'send me a new link'. Always answered with GENERIC_RESEND, whatever happens here."""
    user = None
    if token:
        row = _token_row(db, AccountActivation, token)
        user = db.get(User, row.user_id) if row is not None else None
    elif identifier:
        user = find_by_identifier(db, identifier)
    if user is None or user.status_value != AccountStatus.PENDING_ACTIVATION:
        return None
    stamp = now()
    recent = db.query(AccountActivation).filter(
        AccountActivation.user_id == user.id, AccountActivation.created_at >= stamp - datetime.timedelta(hours=1)
    ).order_by(AccountActivation.created_at.desc()).all()
    if recent and ((stamp - recent[0].created_at).total_seconds() < PUBLIC_RESEND_SECONDS or len(recent) >= PUBLIC_MAX_PER_HOUR):
        security_events.record(db, "SUSPICIOUS_ACTIVITY", user=user, ip_address=ip, user_agent=ua,
                               details={"reason": "activation resend rate limit"})
        db.commit()
        return None
    security_events.record(db, "ACTIVATION_RESENT", user=user, ip_address=ip, user_agent=ua, details={"self_service": True})
    pending = _issue_activation(db, user, None, "resent")
    db.commit()
    return pending


# ---------------- password reset (existing ACTIVE accounts only) ----------------

def _reset_minutes(db: Session) -> int:
    return int(settings.get(db, "security.password_reset_minutes") or 30)


def _issue_reset(db: Session, user: User, actor: Optional[User]) -> PendingSms:
    stamp = now()
    for row in db.query(PasswordReset).filter(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None), PasswordReset.revoked_at.is_(None)):
        row.revoked_at = stamp
    token = generate_token()
    minutes = _reset_minutes(db)
    reset = PasswordReset(
        user_id=user.id, token_hash=hash_token(token), requested_by=actor.id if actor else None,
        created_at=stamp, expires_at=stamp + datetime.timedelta(minutes=minutes),
    )
    db.add(reset)
    db.flush()
    text = f"MilkOS password reset: {APP_URL}{RESET_PATH}#t={token} . The link expires in {minutes} minutes. If you didn't ask for this, ignore this message."
    stored = f"MilkOS password reset: [one-time link hidden] . The link expires in {minutes} minutes. If you didn't ask for this, ignore this message."
    pending = _queue_sms(db, user, kind="RESET", ntype="PASSWORD_RESET", text=text, stored=stored, actor=actor)
    reset.notification_id = pending.notification_id
    return pending


def request_password_reset(db: Session, identifier: str, *, ip=None, ua=None) -> Optional[PendingSms]:
    """Self-service request. Always answered with GENERIC_RESET."""
    user = find_by_identifier(db, identifier)
    if user is None or user.status_value != AccountStatus.ACTIVE:
        return None
    stamp = now()
    recent = db.query(PasswordReset).filter(
        PasswordReset.user_id == user.id, PasswordReset.created_at >= stamp - datetime.timedelta(hours=1)
    ).order_by(PasswordReset.created_at.desc()).all()
    if recent and ((stamp - recent[0].created_at).total_seconds() < PUBLIC_RESEND_SECONDS or len(recent) >= PUBLIC_MAX_PER_HOUR):
        return None
    security_events.record(db, "PASSWORD_RESET_REQUESTED", user=user, ip_address=ip, user_agent=ua)
    pending = _issue_reset(db, user, None)
    db.commit()
    return pending


def admin_password_reset(db: Session, principal, user: User) -> PendingSms:
    """An administrator sends a reset link to the person's own phone. The administrator never learns the password."""
    _guard_admin_target(principal, user)
    if user.status_value == AccountStatus.PENDING_ACTIVATION:
        raise HTTPException(status.HTTP_409_CONFLICT, "This account hasn't been activated yet. Resend the activation link instead.")
    if user.status_value != AccountStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Reactivate the account before sending a password reset.")
    security_events.from_principal(db, principal, "PASSWORD_RESET_REQUESTED", user=user, details={"by_administrator": True})
    pending = _issue_reset(db, user, principal.user)
    db.commit()
    return pending


def inspect_reset(db: Session, token: str) -> dict:
    row = _token_row(db, PasswordReset, token)
    state = _token_state(row)
    user = db.get(User, row.user_id) if row is not None else None
    if state == "VALID" and (user is None or user.status_value != AccountStatus.ACTIVE):
        state = "REVOKED"
    out = {"state": state}
    if state == "VALID":
        out.update({"phone_masked": mask_phone_local(user.phone_number), "expires_at": _iso(row.expires_at)})
    return out


def complete_reset(db: Session, token: str, password: str, *, ip=None, ua=None) -> User:
    row = _token_row(db, PasswordReset, token)
    state = _token_state(row)
    user = db.get(User, row.user_id) if row is not None else None
    if state != "VALID" or user is None or user.status_value != AccountStatus.ACTIVE:
        raise HTTPException(status.HTTP_410_GONE, {
            "EXPIRED": "This reset link has expired. Request a new one.",
            "USED": "This reset link has already been used.",
        }.get(state, "This reset link is not valid. Request a new one."))
    stamp = now()
    row.used_at = stamp
    set_password(db, user, password)
    user.failed_login_count = 0
    user.locked_until = None
    revoke_sessions(db, user, keep_device_identifier=None)
    security_events.record(db, "PASSWORD_RESET_COMPLETED", user=user, ip_address=ip, user_agent=ua)
    db.commit()
    return user


# ---------------- passwords & sessions ----------------

def set_password(db: Session, user: User, password: str) -> None:
    if user.password_hash and verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, [{"loc": ["body", "new_password"], "msg": "Choose a password you haven't used here before.", "type": "value_error"}])
    user.password_hash = hash_password(password)
    user.password_set_at = now()
    user.must_change_password = False
    for row in db.query(PasswordReset).filter(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None), PasswordReset.revoked_at.is_(None)):
        row.revoked_at = now()


def revoke_sessions(db: Session, user: User, keep_device_identifier: Optional[str], only_session_id: Optional[UUID] = None) -> int:
    """End sessions: every offline device session of `user` (except the one on `keep_device_identifier`), or just
    `only_session_id`. Also bumps the session epoch, so every access token issued before stops working; devices
    whose session is still valid silently get a fresh token from their device session."""
    from models.sync import Device

    stamp = now()
    query = db.query(DeviceSession).filter(DeviceSession.user_id == user.id, DeviceSession.revoked_at.is_(None))
    if only_session_id is not None:
        query = query.filter(DeviceSession.id == only_session_id)
    keep_id = None
    if keep_device_identifier:
        device = db.query(Device).filter(Device.device_identifier == keep_device_identifier).first()
        keep_id = device.id if device else None
    count = 0
    for session in query:
        if keep_id is not None and session.device_id == keep_id:
            continue
        session.revoked_at = stamp
        count += 1
    user.session_epoch = (user.session_epoch or 0) + 1
    return count


# ---------------- phone numbers ----------------

def _phone_taken(db: Session, phone: str, exclude_id: UUID) -> bool:
    return db.query(User.id).filter(User.phone_number == phone, User.id != exclude_id).first() is not None


def request_phone_change(db: Session, principal, user: User, new_phone: str, password: str) -> tuple[PhoneVerification, PendingSms]:
    """Step 1: prove the password, then send a code to the NEW number. Nothing changes until the code is entered."""
    if not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, [{"loc": ["body", "password"], "msg": "Your current password is not right.", "type": "value_error"}])
    if new_phone == user.phone_number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, [{"loc": ["body", "phone"], "msg": "This is already your phone number.", "type": "value_error"}])
    if _phone_taken(db, new_phone, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, [{"loc": ["body", "phone"], "msg": "This phone number can't be used for your account. Contact your administrator.", "type": "conflict"}])
    otp, pending = _send_otp(db, user, OtpPurpose.PHONE_CHANGE, new_phone, requested_by=user)
    security_events.from_principal(db, principal, "PHONE_CHANGE_REQUESTED", user=user, details={"new_phone": mask_phone_local(new_phone)})
    db.commit()
    return otp, pending


def request_phone_verification(db: Session, principal, user: User) -> tuple[PhoneVerification, PendingSms]:
    """Send a code to the CURRENT number (after an administrator changed it, or it was never verified)."""
    otp, pending = _send_otp(db, user, OtpPurpose.PHONE_CHANGE, user.phone_number, requested_by=user)
    security_events.from_principal(db, principal, "OTP_REQUESTED", user=user, details={"purpose": "PHONE_VERIFICATION"})
    db.commit()
    return otp, pending


def confirm_phone(db: Session, principal, user: User, verification_id: UUID, code: str,
                  keep_device_identifier: Optional[str]) -> tuple[User, Optional[PendingSms]]:
    """Step 2: the right code makes the number verified (and, for a change, replaces the old one)."""
    from models.farmer import Farmer

    otp = db.get(PhoneVerification, verification_id)
    if otp is None or otp.user_id != user.id or otp.purpose != OtpPurpose.PHONE_CHANGE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Request a new code.")
    _check_otp(db, otp, code, user, principal.ip_address, principal.user_agent)
    notice = None
    if otp.phone != user.phone_number:
        if _phone_taken(db, otp.phone, user.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "This phone number can't be used for your account. Contact your administrator.")
        old = user.phone_number
        user.phone_number = otp.phone
        farmer = db.query(Farmer).filter(Farmer.user_id == user.id).first()
        if farmer is not None:
            clash = db.query(Farmer.id).filter(Farmer.cooperative_id == farmer.cooperative_id, Farmer.phone == otp.phone, Farmer.id != farmer.id).first()
            if clash:
                raise HTTPException(status.HTTP_409_CONFLICT, "Another farmer in your cooperative uses this number. Contact your cooperative.")
            farmer.phone = otp.phone
        security_events.from_principal(db, principal, "PHONE_CHANGED", user=user,
                                       details={"old_phone": mask_phone_local(old), "new_phone": mask_phone_local(otp.phone)})
        # Policy: a new phone number signs out every other session.
        revoke_sessions(db, user, keep_device_identifier=keep_device_identifier)
        text = (f"Your MilkOS phone number was changed to {mask_phone_local(otp.phone).replace('•', 'X')}. "
                "If you didn't do this, contact your cooperative or MilkOS support now.")
        notice = _queue_sms(db, user, kind="NOTICE", ntype="SECURITY_NOTICE", text=text, stored=text, phone=old, severity="WARNING")
        # SECURITY_NOTICE is not secret, so it can go through the normal path.
        notice = PendingSms(notification_id=notice.notification_id, text=text, user_id=user.id, kind="NOTICE")
    else:
        security_events.from_principal(db, principal, "PHONE_VERIFIED", user=user)
    user.phone_verified_at = now()
    db.commit()
    db.refresh(user)
    return user, notice


def phone_changed_by_admin(db: Session, principal, user: User, old_phone: str) -> Optional[PendingSms]:
    """An administrator replaced someone's number: it is unverified until its owner confirms it, and a pending
    invitation is re-sent to the new number (the old link went to the old one). Doesn't commit."""
    if old_phone == user.phone_number:
        return None
    user.phone_verified_at = None
    security_events.from_principal(db, principal, "PHONE_CHANGED", user=user, details={
        "old_phone": mask_phone_local(old_phone), "new_phone": mask_phone_local(user.phone_number), "by_administrator": True,
    })
    if user.status_value == AccountStatus.PENDING_ACTIVATION:
        return _issue_activation(db, user, principal.user, "phone changed")
    return None


# ---------------- account status ----------------

STATUS_EVENTS = {
    AccountStatus.SUSPENDED: "ACCOUNT_SUSPENDED",
    AccountStatus.DISABLED: "ACCOUNT_DISABLED",
    AccountStatus.ACTIVE: "ACCOUNT_REACTIVATED",
}


def change_status(db: Session, principal, user: User, new_status: str, reason: Optional[str]) -> tuple[User, Optional[PendingSms]]:
    """Suspend, disable or reactivate. Reactivating an account that never set a password sends a new activation
    link instead (it goes back to PENDING_ACTIVATION). Doesn't touch history. Commits."""
    if new_status not in STATUS_EVENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose ACTIVE, SUSPENDED or DISABLED.")
    _guard_admin_target(principal, user)
    current = user.status_value
    if current == new_status:
        return user, None
    if new_status != AccountStatus.ACTIVE and user.role_value == UserRole.SUPER_ADMIN.value:
        others = db.query(User.id).filter(
            User.role == UserRole.SUPER_ADMIN, User.account_status == AccountStatus.ACTIVE, User.id != user.id
        ).count()
        if others == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "This is the last active superadmin; it can't be deactivated.")
    pending = None
    if new_status == AccountStatus.ACTIVE and not user.password_hash:
        user.set_status(AccountStatus.PENDING_ACTIVATION, None)
        security_events.from_principal(db, principal, "ACCOUNT_REACTIVATED", user=user, details={"reason": reason, "needs_activation": True})
        pending = _issue_activation(db, user, principal.user, "reactivated")
    else:
        if current == AccountStatus.PENDING_ACTIVATION:
            _revoke_activations(db, user.id, "status changed")
        user.set_status(new_status, (reason or "").strip() or None)
        if new_status != AccountStatus.ACTIVE:
            revoke_sessions(db, user, keep_device_identifier=None)
        security_events.from_principal(db, principal, STATUS_EVENTS[new_status], user=user, details={"reason": reason, "previous": current})
    db.commit()
    db.refresh(user)
    return user, pending


# ---------------- sign-in checks ----------------

def login_block_reason(user: User) -> Optional[tuple[int, str, str]]:
    """(http status, code, message) when this account may not sign in, else None."""
    state = user.status_value
    if state == AccountStatus.PENDING_ACTIVATION:
        return 403, "activation_required", (
            "This account hasn't been activated yet. Open the activation link we sent by SMS, or request a new one."
        )
    if state == AccountStatus.PENDING_APPROVAL:
        return 403, "pending_approval", "Account is pending approval or inactive."
    if state == AccountStatus.SUSPENDED:
        return 403, "suspended", "This account is suspended. Contact your administrator."
    if state == AccountStatus.DISABLED:
        return 403, "disabled", "This account has been disabled. Contact your administrator."
    return None


def note_failed_login(db: Session, user: User, ip=None, ua=None) -> None:
    user.failed_login_count = (user.failed_login_count or 0) + 1
    security_events.record(db, "LOGIN_FAILED", user=user, ip_address=ip, user_agent=ua,
                           details={"failed_attempts": user.failed_login_count})
    if user.failed_login_count >= LOCKOUT_THRESHOLD:
        user.locked_until = now() + datetime.timedelta(minutes=LOCKOUT_MINUTES)
        user.failed_login_count = 0
        security_events.record(db, "LOGIN_LOCKED", user=user, ip_address=ip, user_agent=ua, details={"minutes": LOCKOUT_MINUTES})
    db.commit()


def is_locked(user: User) -> bool:
    return user.locked_until is not None and user.locked_until > now()
