"""The signed-in person's own account: profile, password, sessions and two-step verification.

Every function acts on `principal.user` only; nothing takes a user id, a role or a cooperative from the request.
Functions that end other sessions return the user so the API layer can give the caller a fresh token.
"""
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.permissions import permission_names
from app.core.security import verify_password
from app.core.utils import iso
from app.core.validation import mask_phone_local
from app.domain.exceptions import Conflict, InvalidRequest, NotFound, PermissionDenied, ValidationFailed
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.admin import Cooler
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.operations import Collector
from app.infrastructure.db.models.sync import Device, DeviceSession
from app.infrastructure.db.models.user import User
from app.services import accounts, audit, mfa, security_events
from app.services.principal import Principal
from app.services.users import EMAIL_REQUIRED_ROLES as EMAIL_REQUIRED

NAME_LOCKED = {UserRole.FARMER.value}          # the member register (kept by the cooperative) owns a farmer's name


def reauth(user: User, password: Optional[str], field: str = "password") -> None:
    if not password or not verify_password(password, user.password_hash):
        raise InvalidRequest("Your current password is not right.", loc=["body", field], kind="value_error")


def _role_profile(db: Session, user: User) -> dict:
    role = user.role_value
    if role == UserRole.COLLECTOR.value:
        c = db.query(Collector).filter(Collector.user_id == user.id).first()
        if c is None:
            return {}
        centre = db.get(CollectionCentre, c.centre_id) if c.centre_id else None
        cooler = db.get(Cooler, c.cooler_id) if c.cooler_id else None
        return {
            "collector_number": c.collector_number, "assigned_area": c.assigned_area, "collector_status": c.status,
            "centre_id": str(c.centre_id) if c.centre_id else None, "centre_name": centre.name if centre else None,
            "cooler_id": str(c.cooler_id) if c.cooler_id else None, "cooler_name": cooler.name if cooler else None,
        }
    if role == UserRole.FARMER.value:
        f = db.query(Farmer).filter(Farmer.user_id == user.id).first()
        if f is None:
            return {}
        centre = db.get(CollectionCentre, f.centre_id) if f.centre_id else None
        account = f.payment_account or ""
        return {
            "farmer_id": str(f.id), "farmer_number": f.farmer_number, "village": f.village,
            "number_of_cows": f.number_of_cows, "farmer_status": f.status,
            "centre_id": str(f.centre_id) if f.centre_id else None, "centre_name": centre.name if centre else None,
            "payment_method": f.payment_method,
            "payment_account_masked": (mask_phone_local(account) if f.payment_method == "MPESA" else
                                       (f"••••{account[-4:]}" if account else None)),
            "bank_name": f.bank_name, "member_since": iso(f.created_at),
        }
    return {}


def account_json(db: Session, user: User) -> dict:
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    role = user.role_value
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone_number,  # the account's own number, shown to its owner only
        "phone_masked": mask_phone_local(user.phone_number),
        "phone_verified": user.phone_verified_at is not None,
        "phone_verified_at": iso(user.phone_verified_at),
        "role": role,
        "account_status": user.status_value,
        "must_change_password": bool(user.must_change_password),
        "password_set_at": iso(user.password_set_at),
        "mfa_enabled": bool(user.mfa_enabled),
        "mfa_enabled_at": iso(user.mfa_enabled_at),
        "recovery_codes_left": len(user.mfa_recovery_codes or []) if user.mfa_enabled else 0,
        "activated_at": iso(user.activated_at),
        "created_at": iso(user.created_at),
        "last_login_at": iso(user.last_login_at),
        "cooperative": {"id": str(coop.id), "name": coop.name, "code": coop.code, "status": coop.status} if coop else None,
        "profile": _role_profile(db, user),
        "editable": {
            "full_name": role not in NAME_LOCKED,
            "email": True,
            "email_required": role in EMAIL_REQUIRED,
            "phone": True,  # always through the code-verified flow
        },
        "permissions": permission_names(role),
    }


def update_profile(db: Session, principal: Principal, full_name: Optional[str], email: Optional[str], clear_email: bool,
                   current_password: Optional[str]) -> User:
    """Name and email. Changing the email needs the current password. Commits when something changed."""
    user = principal.user
    role = user.role_value
    changes: dict[str, Any] = {}
    if full_name is not None and full_name != user.full_name:
        if role in NAME_LOCKED:
            raise PermissionDenied("Your name is kept by your cooperative. Ask them to correct it.")
        changes["full_name"] = full_name
    new_email = None if clear_email else email
    if (clear_email or email is not None) and new_email != user.email:
        if new_email is None and role in EMAIL_REQUIRED:
            raise ValidationFailed("Your account needs an email address.", "email", kind="value_error")
        reauth(user, current_password, "current_password")
        if new_email and db.query(User.id).filter(User.email == new_email, User.id != user.id).first():
            raise Conflict("This email address can't be used. Try another.", "email")
        changes["email"] = new_email
    if changes:
        old = {k: getattr(user, k) for k in changes}
        for key, value in changes.items():
            setattr(user, key, value)
        audit.record(db, principal, "PROFILE_UPDATED", target=user.label, entity_type="user", entity_id=user.id,
                     cooperative_id=user.cooperative_id, old_values=old, new_values=changes)
        db.commit()
        db.refresh(user)
    return user


def change_password(db: Session, principal: Principal, current_password: str, new_password: str,
                    keep_device_identifier: Optional[str]) -> User:
    """Every other session is signed out. Commits."""
    user = principal.user
    reauth(user, current_password, "current_password")
    accounts.set_password(db, user, new_password)
    accounts.revoke_sessions(db, user, keep_device_identifier=keep_device_identifier)
    security_events.from_principal(db, principal, "PASSWORD_CHANGED")
    db.commit()
    db.refresh(user)
    return user


# ---------------- sessions & devices ----------------

def _session_json(s: DeviceSession, d: Device, current_device: Optional[str]) -> dict:
    return {
        "id": str(s.id),
        "device_id": str(d.id),
        "label": d.label,
        "platform": d.platform,
        "app_version": d.app_version,
        "user_agent": d.user_agent,
        "signed_in_at": iso(s.issued_at),
        "last_active_at": iso(s.last_validated_at or d.last_seen_at),
        "last_sync_at": iso(d.last_sync_at),
        "expires_at": iso(s.expires_at),
        "device_active": bool(d.is_active),
        "current": bool(current_device and d.device_identifier == current_device),
    }


def list_sessions(db: Session, principal: Principal, current_device: Optional[str]) -> list[dict]:
    now = accounts.now()
    rows = (
        db.query(DeviceSession, Device)
        .join(Device, Device.id == DeviceSession.device_id)
        .filter(DeviceSession.user_id == principal.user.id, DeviceSession.revoked_at.is_(None), DeviceSession.expires_at > now)
        .order_by(DeviceSession.last_validated_at.desc())
        .all()
    )
    return [_session_json(s, d, current_device) for s, d in rows]


def revoke_session(db: Session, principal: Principal, session_id: UUID, current_device: Optional[str]) -> bool:
    """Sign one device out. Commits. True when that device is the caller's own (it is now signed out)."""
    user = principal.user
    session = db.get(DeviceSession, session_id)
    if session is None or session.user_id != user.id:
        raise NotFound("Session")
    device = db.get(Device, session.device_id)
    accounts.revoke_sessions(db, user, keep_device_identifier=None, only_session_id=session.id)
    security_events.from_principal(db, principal, "SESSION_REVOKED", details={"device": (device.label or device.device_identifier[:8]) if device else None})
    db.commit()
    db.refresh(user)
    return bool(device and current_device and device.device_identifier == current_device)


def revoke_other_sessions(db: Session, principal: Principal, keep_device_identifier: Optional[str]) -> int:
    user = principal.user
    count = accounts.revoke_sessions(db, user, keep_device_identifier=keep_device_identifier)
    security_events.from_principal(db, principal, "SESSIONS_REVOKED", details={"count": count})
    db.commit()
    db.refresh(user)
    return count


# ---------------- two-step verification (TOTP) ----------------

def mfa_setup(db: Session, principal: Principal, password: str) -> dict:
    """Start enrolment: returns the secret ONCE (for the authenticator app). Not active until mfa_enable."""
    user = principal.user
    reauth(user, password)
    if user.mfa_enabled:
        raise Conflict("Two-step verification is already on.")
    secret = mfa.new_secret()
    user.mfa_secret_encrypted = mfa.encrypt(secret)
    db.commit()
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user.email or mask_phone_local(user.phone_number))}


def mfa_enable(db: Session, principal: Principal, code: str) -> list[str]:
    """Turn two-step verification on; returns the recovery codes (shown once)."""
    user = principal.user
    if user.mfa_enabled:
        raise Conflict("Two-step verification is already on.")
    if not mfa.verify_totp(mfa.decrypt(user.mfa_secret_encrypted), code):
        raise InvalidRequest("That code is not right. Check the time on your phone and try again.", "code", kind="value_error")
    codes, hashes = mfa.new_recovery_codes()
    user.mfa_enabled = True
    user.mfa_enabled_at = accounts.now()
    user.mfa_recovery_codes = hashes
    security_events.from_principal(db, principal, "MFA_ENABLED")
    db.commit()
    return codes


def _check_mfa(user: User, password: str, code: str) -> None:
    if not user.mfa_enabled:
        raise Conflict("Two-step verification is off.")
    reauth(user, password)
    secret = mfa.decrypt(user.mfa_secret_encrypted)
    if not mfa.verify_totp(secret, code) and mfa.use_recovery_code(user.mfa_recovery_codes, code) is None:
        raise InvalidRequest("That code is not right.", "code", kind="value_error")


def mfa_disable(db: Session, principal: Principal, password: str, code: str) -> None:
    user = principal.user
    _check_mfa(user, password, code)
    user.mfa_enabled = False
    user.mfa_secret_encrypted = None
    user.mfa_recovery_codes = None
    user.mfa_enabled_at = None
    security_events.from_principal(db, principal, "MFA_DISABLED")
    db.commit()


def mfa_new_recovery_codes(db: Session, principal: Principal, password: str, code: str) -> list[str]:
    user = principal.user
    _check_mfa(user, password, code)
    codes, hashes = mfa.new_recovery_codes()
    user.mfa_recovery_codes = hashes
    security_events.from_principal(db, principal, "MFA_ENABLED", details={"recovery_codes_regenerated": True})
    db.commit()
    return codes
