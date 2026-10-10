"""Personal account settings for every role: /api/v1/account.

Profile, password, phone number (with SMS code), two-step verification, sessions/devices, notification and work
preferences, and the account's own security history. Everything here acts on the signed-in account only: no
endpoint takes a user id, a role or a cooperative from the request, so nobody can reach another account through it.
Administrative settings (cooperative, platform) live in their own routers and permissions.

Security operations (password, phone, MFA, sessions) are online-only by nature: they run here, on the server.
"""
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

from core.access import Principal, load_principal
from core.permissions import permissions_for
from core.security import access_token_for, verify_password
from core.utils import iso
from core.validation import clean_text, mask_phone_local, normalize_email, normalize_phone, pydantic_field
from db import get_db
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector
from models.sync import Device, DeviceSession
from models.user import User
from routers.auth import set_session_cookie
from schemas.auth import PasswordChange, UserRole
from services import accounts, mfa, preferences, security_events

router = APIRouter(prefix="/api/v1/account", tags=["My account"])

NAME_LOCKED = {UserRole.FARMER.value}          # the member register (kept by the cooperative) owns a farmer's name
EMAIL_REQUIRED = {UserRole.SUPER_ADMIN.value, UserRole.COOP_ADMIN.value, UserRole.MANAGER.value}


class _Strict(BaseModel):
    # Unknown fields (role, cooperative_id, farmer_number...) are refused, not silently ignored.
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class ProfileUpdate(_Strict):
    full_name: Optional[str] = Field(None, min_length=3, max_length=255)
    email: Optional[EmailStr] = None
    clear_email: bool = False
    current_password: Optional[str] = Field(None, max_length=128)

    _name = field_validator("full_name")(lambda v: clean_text(v) if v is not None else v)
    _email = field_validator("email")(lambda v: normalize_email(v) if v is not None else v)


class PreferencesUpdate(_Strict):
    notifications: Optional[dict[str, bool]] = None
    work: Optional[dict[str, Any]] = None


class PhoneChange(_Strict):
    phone: str
    password: str = Field(..., min_length=1, max_length=128)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))


class PhoneConfirm(_Strict):
    verification_id: UUID
    code: str = Field(..., min_length=4, max_length=10)
    device_identifier: Optional[str] = Field(None, max_length=64)


class PasswordConfirm(_Strict):
    password: str = Field(..., min_length=1, max_length=128)


class MfaCode(_Strict):
    code: str = Field(..., min_length=6, max_length=20)


class MfaSensitive(_Strict):
    password: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., min_length=6, max_length=20)


class RevokeOthers(_Strict):
    device_identifier: Optional[str] = Field(None, max_length=64)


class PasswordChangeBody(PasswordChange):
    device_identifier: Optional[str] = Field(None, max_length=64)


def _reauth(user: User, password: Optional[str], field: str = "password") -> None:
    if not password or not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, [{"loc": ["body", field], "msg": "Your current password is not right.", "type": "value_error"}])


def _reissue(response: Response, user: User) -> str:
    """After the session epoch moved, give the caller (only) a fresh token so they stay signed in."""
    token = access_token_for(user)
    set_session_cookie(response, token)
    return token


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
            "phone": True,  # always through the code-verified flow below
        },
        "permissions": sorted(p.value for p in permissions_for(role)),
    }


@router.get("/me")
def me(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return account_json(db, principal.user)


@router.patch("/profile")
def update_profile(body: ProfileUpdate, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    role = user.role_value
    changes: dict[str, Any] = {}
    if body.full_name is not None and body.full_name != user.full_name:
        if role in NAME_LOCKED:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your name is kept by your cooperative. Ask them to correct it.")
        changes["full_name"] = body.full_name
    new_email = None if body.clear_email else body.email
    if (body.clear_email or body.email is not None) and new_email != user.email:
        if new_email is None and role in EMAIL_REQUIRED:
            raise HTTPException(422, [{"loc": ["body", "email"], "msg": "Your account needs an email address.", "type": "value_error"}])
        _reauth(user, body.current_password, "current_password")
        if new_email and db.query(User.id).filter(User.email == new_email, User.id != user.id).first():
            raise HTTPException(409, [{"loc": ["body", "email"], "msg": "This email address can't be used. Try another.", "type": "conflict"}])
        changes["email"] = new_email
    if changes:
        old = {k: getattr(user, k) for k in changes}
        for key, value in changes.items():
            setattr(user, key, value)
        from services import audit

        audit.record(db, principal, "PROFILE_UPDATED", target=user.label, entity_type="user", entity_id=user.id,
                     cooperative_id=user.cooperative_id, old_values=old, new_values=changes)
        db.commit()
        db.refresh(user)
    return account_json(db, user)


@router.post("/password")
def change_password(body: PasswordChangeBody, response: Response, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Change the password. Every other session is signed out; this one gets a fresh token."""
    user = principal.user
    _reauth(user, body.current_password, "current_password")
    accounts.set_password(db, user, body.new_password)
    accounts.revoke_sessions(db, user, keep_device_identifier=body.device_identifier)
    security_events.from_principal(db, principal, "PASSWORD_CHANGED")
    db.commit()
    db.refresh(user)
    return {"changed": True, "access_token": _reissue(response, user)}


@router.get("/preferences")
def get_preferences(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return preferences.get(db, principal.user)


@router.put("/preferences")
def put_preferences(body: PreferencesUpdate, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return preferences.update(db, principal.user, body.notifications, body.work)


# ---------------- phone number ----------------

def _otp_response(otp, n) -> dict:
    return {
        "verification_id": str(otp.id),
        "phone_masked": mask_phone_local(otp.phone),
        "expires_in_seconds": accounts.OTP_MINUTES * 60,
        "resend_after_seconds": accounts.OTP_RESEND_SECONDS,
        **accounts.sms_outcome(n),
    }


@router.post("/phone/change")
def phone_change(body: PhoneChange, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Send a code to the NEW number. The old number stays until the code is confirmed."""
    otp, pending = accounts.request_phone_change(db, principal, principal.user, body.phone, body.password)
    return _otp_response(otp, accounts.dispatch(db, pending))


@router.post("/phone/verify-current")
def phone_verify_current(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    otp, pending = accounts.request_phone_verification(db, principal, principal.user)
    return _otp_response(otp, accounts.dispatch(db, pending))


@router.post("/phone/confirm")
def phone_confirm(body: PhoneConfirm, response: Response, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    before = principal.user.session_epoch
    user, notice = accounts.confirm_phone(db, principal, principal.user, body.verification_id, body.code, body.device_identifier)
    accounts.dispatch(db, notice)  # tell the old number (best effort, after the change is saved)
    out = account_json(db, user)
    if user.session_epoch != before:
        out["access_token"] = _reissue(response, user)
    return out


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


@router.get("/sessions")
def list_sessions(
    device_identifier: Optional[str] = Query(None, max_length=64),
    principal: Principal = Depends(load_principal), db: Session = Depends(get_db),
):
    """This account's signed-in devices. Location is not shown: MilkOS doesn't resolve addresses to places."""
    now = accounts.now()
    rows = (
        db.query(DeviceSession, Device)
        .join(Device, Device.id == DeviceSession.device_id)
        .filter(DeviceSession.user_id == principal.user.id, DeviceSession.revoked_at.is_(None), DeviceSession.expires_at > now)
        .order_by(DeviceSession.last_validated_at.desc())
        .all()
    )
    return [_session_json(s, d, device_identifier) for s, d in rows]


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: UUID, response: Response, device_identifier: Optional[str] = Query(None, max_length=64),
                   principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    session = db.get(DeviceSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    device = db.get(Device, session.device_id)
    accounts.revoke_sessions(db, user, keep_device_identifier=None, only_session_id=session.id)
    security_events.from_principal(db, principal, "SESSION_REVOKED", details={"device": (device.label or device.device_identifier[:8]) if device else None})
    db.commit()
    db.refresh(user)
    current = bool(device and device_identifier and device.device_identifier == device_identifier)
    return {"revoked": True, "signed_out_here": current, "access_token": None if current else _reissue(response, user)}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(body: RevokeOthers, response: Response, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    count = accounts.revoke_sessions(db, user, keep_device_identifier=body.device_identifier)
    security_events.from_principal(db, principal, "SESSIONS_REVOKED", details={"count": count})
    db.commit()
    db.refresh(user)
    return {"revoked": count, "access_token": _reissue(response, user)}


@router.get("/security-events")
def my_security_events(limit: int = Query(50, ge=1, le=200), principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return [security_events.event_json(e) for e in security_events.for_user(db, principal.user.id, limit)]


# ---------------- two-step verification (TOTP) ----------------

@router.post("/mfa/setup")
def mfa_setup(body: PasswordConfirm, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Start enrolment: returns the secret ONCE (for the authenticator app). Not active until /mfa/enable."""
    user = principal.user
    _reauth(user, body.password)
    if user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step verification is already on.")
    secret = mfa.new_secret()
    user.mfa_secret_encrypted = mfa.encrypt(secret)
    db.commit()
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user.email or mask_phone_local(user.phone_number))}


@router.post("/mfa/enable")
def mfa_enable(body: MfaCode, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    if user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step verification is already on.")
    if not mfa.verify_totp(mfa.decrypt(user.mfa_secret_encrypted), body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, [{"loc": ["body", "code"], "msg": "That code is not right. Check the time on your phone and try again.", "type": "value_error"}])
    codes, hashes = mfa.new_recovery_codes()
    user.mfa_enabled = True
    user.mfa_enabled_at = accounts.now()
    user.mfa_recovery_codes = hashes
    security_events.from_principal(db, principal, "MFA_ENABLED")
    db.commit()
    return {"enabled": True, "recovery_codes": codes}


def _check_mfa(user: User, body: MfaSensitive) -> None:
    _reauth(user, body.password)
    secret = mfa.decrypt(user.mfa_secret_encrypted)
    if not mfa.verify_totp(secret, body.code) and mfa.use_recovery_code(user.mfa_recovery_codes, body.code) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, [{"loc": ["body", "code"], "msg": "That code is not right.", "type": "value_error"}])


@router.post("/mfa/disable")
def mfa_disable(body: MfaSensitive, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    if not user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step verification is off.")
    _check_mfa(user, body)
    user.mfa_enabled = False
    user.mfa_secret_encrypted = None
    user.mfa_recovery_codes = None
    user.mfa_enabled_at = None
    security_events.from_principal(db, principal, "MFA_DISABLED")
    db.commit()
    return {"enabled": False}


@router.post("/mfa/recovery-codes")
def mfa_new_recovery_codes(body: MfaSensitive, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = principal.user
    if not user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step verification is off.")
    _check_mfa(user, body)
    codes, hashes = mfa.new_recovery_codes()
    user.mfa_recovery_codes = hashes
    security_events.from_principal(db, principal, "MFA_ENABLED", details={"recovery_codes_regenerated": True})
    db.commit()
    return {"recovery_codes": codes}
