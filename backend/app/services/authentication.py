"""Signing in and out: password, two-step verification, Google, and token refresh.

Returns the signed-in user and an access token; setting the session cookie is the API layer's job.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.permissions import permission_names
from app.core.security import (
    access_token_for, create_purpose_token, decode_access_token, decode_purpose_token, hash_password, verify_password,
)
from app.domain.exceptions import DomainError, InvalidRequest, PermissionDenied, RateLimited, Unauthenticated
from app.infrastructure.db.models.user import AccountStatus, User
from app.services import accounts, mfa, security_events

INVALID_CREDENTIALS = "Invalid email or password"
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


@dataclass
class SignIn:
    """A finished sign-in (`token` set) or one that still needs the second factor (`token` None)."""
    user: User
    token: Optional[str] = None
    mfa_token: Optional[str] = None

    def json(self) -> dict:
        if self.mfa_token:
            return {
                "mfa_required": True,
                "mfa_token": self.mfa_token,
                "message": "Enter the 6-digit code from your authenticator app.",
            }
        return {
            "message": "Login successful",
            "access_token": self.token,
            "role": self.user.role_value,
            "user_id": str(self.user.id),
            "must_change_password": bool(self.user.must_change_password),
        }


def _user_for(db: Session, claims: Optional[dict]) -> Optional[User]:
    """The account a token's subject names, or None (missing or malformed subject, deleted account)."""
    try:
        return db.get(User, UUID(claims["sub"])) if claims else None
    except (ValueError, KeyError):
        return None


def _blocked(status: int, code: str, message: str) -> DomainError:
    cls = RateLimited if status == 429 else PermissionDenied
    return cls(message, code=code)


def _finish(db: Session, user: User, ip, ua, method: str) -> SignIn:
    user.last_login_at = datetime.utcnow()
    user.failed_login_count = 0
    user.locked_until = None
    security_events.record(db, "LOGIN_SUCCESS", user=user, ip_address=ip, user_agent=ua, details={"method": method})
    db.commit()
    return SignIn(user=user, token=access_token_for(user))


def password_login(db: Session, identifier: Optional[str], password: str, ip=None, ua=None) -> SignIn:
    """Email or phone number plus password. Accounts with two-step verification get an mfa_token instead."""
    user = accounts.find_by_identifier(db, identifier) if identifier else None
    if user is None:
        verify_password(password, _DUMMY_HASH)  # same work either way: no account-existence timing hint
        raise Unauthenticated(INVALID_CREDENTIALS)
    if accounts.is_locked(user):
        raise _blocked(429, "locked", "Too many failed sign-in attempts. Try again in a few minutes or reset your password.")
    if user.status_value == AccountStatus.PENDING_ACTIVATION:
        # No password exists yet: point the person at their activation link.
        raise _blocked(*accounts.login_block_reason(user))
    if not verify_password(password, user.password_hash):
        accounts.note_failed_login(db, user, ip, ua)
        raise Unauthenticated(INVALID_CREDENTIALS)
    blocked = accounts.login_block_reason(user)
    if blocked:
        security_events.record(db, "LOGIN_BLOCKED", user=user, ip_address=ip, user_agent=ua, details={"status": user.status_value})
        db.commit()
        raise _blocked(*blocked)
    if user.mfa_enabled:
        return SignIn(user=user, mfa_token=create_purpose_token(str(user.id), "mfa", minutes=5, sv=int(user.session_epoch or 0)))
    return _finish(db, user, ip, ua, "password")


def mfa_login(db: Session, mfa_token: str, code: str, ip=None, ua=None) -> SignIn:
    """Second sign-in step: a code from the authenticator app, or one unused recovery code."""
    payload = decode_purpose_token(mfa_token, "mfa")
    user = _user_for(db, payload)
    if user is None or not user.mfa_enabled or int(payload.get("sv", -1)) != int(user.session_epoch or 0):
        raise Unauthenticated("Your sign-in has expired. Start again.")
    if accounts.is_locked(user):
        raise _blocked(429, "locked", "Too many failed sign-in attempts. Try again in a few minutes.")
    blocked = accounts.login_block_reason(user)
    if blocked:
        raise _blocked(*blocked)
    code = code.strip()
    method = "mfa"
    if not mfa.verify_totp(mfa.decrypt(user.mfa_secret_encrypted), code):
        remaining = mfa.use_recovery_code(user.mfa_recovery_codes, code)
        if remaining is None:
            security_events.record(db, "MFA_CHALLENGE_FAILED", user=user, ip_address=ip, user_agent=ua)
            accounts.note_failed_login(db, user, ip, ua)
            raise InvalidRequest("That code is not right.")
        user.mfa_recovery_codes = remaining
        method = "recovery_code"
        security_events.record(db, "MFA_RECOVERY_CODE_USED", user=user, ip_address=ip, user_agent=ua,
                               details={"codes_left": len(remaining)})
    return _finish(db, user, ip, ua, method)


def google_login(db: Session, email: str) -> SignIn:
    """Google has proved `email`; sign in its account. An account with two-step verification gets an mfa_token
    and must finish with password and code (Google doesn't prove the second factor)."""
    user = db.query(User).filter(User.email == email.lower()).first()
    if not user:
        raise PermissionDenied("No account associated with this Google email. Please register your cooperative first.")
    blocked = accounts.login_block_reason(user)
    if blocked:
        raise _blocked(*blocked)
    if user.mfa_enabled:
        return SignIn(user=user)
    user.last_login_at = datetime.utcnow()
    security_events.record(db, "LOGIN_SUCCESS", user=user, details={"method": "google"})
    db.commit()
    return SignIn(user=user, token=access_token_for(user))


def session_user(db: Session, claims: dict) -> User:
    """The account behind a valid access token, if its session is still current."""
    user = _user_for(db, claims)
    # A revoked session (older epoch), a deactivated account or a changed role can't be carried forward.
    if not user or not user.is_active or int(claims.get("sv", 0)) != int(user.session_epoch or 0):
        raise Unauthenticated("Account not found or inactive")
    return user


def refresh(db: Session, claims: dict) -> tuple[User, str]:
    user = session_user(db, claims)
    return user, access_token_for(user)


def profile(db: Session, claims: dict) -> dict:
    user = session_user(db, claims)
    role = user.role_value
    return {
        "user_id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": role,
        "cooperative_id": str(user.cooperative_id) if user.cooperative_id else None,
        "account_status": user.status_value,
        "must_change_password": bool(user.must_change_password),
        "phone_verified": user.phone_verified_at is not None,
        "mfa_enabled": bool(user.mfa_enabled),
        # For showing/hiding UI only; every endpoint re-checks on the server.
        "permissions": permission_names(role),
    }


def logout(db: Session, token: Optional[str], ip=None, ua=None) -> None:
    """Note the sign-out of whoever `token` belongs to. A missing or invalid token is not an error."""
    if not token:
        return
    try:
        user = _user_for(db, decode_access_token(token))
    except Unauthenticated:
        return
    if user is not None:
        security_events.record(db, "LOGOUT", user=user, ip_address=ip, user_agent=ua)
        db.commit()
