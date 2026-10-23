"""Personal account settings for every role: /api/v1/account.

Profile, password, phone number (with SMS code), two-step verification, sessions/devices, notification and work
preferences, and the account's own security history. Everything here acts on the signed-in account only: no
endpoint takes a user id, a role or a cooperative from the request, so nobody can reach another account through it.
Administrative settings (cooperative, platform) live in their own routers and permissions.

Security operations (password, phone, MFA, sessions) are online-only by nature: they run here, on the server.
The rules live in app.services.my_account and app.services.accounts.
"""
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

from app.api.cookies import start_session
from app.api.dependencies.auth import load_principal
from app.api.dependencies.db import get_db
from app.core.validation import clean_text, mask_phone_local, normalize_email, normalize_phone, pydantic_field
from app.domain.schemas.auth import PasswordChange
from app.services import accounts, my_account, preferences, security_events
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1/account", tags=["My account"])


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


@router.get("/me")
def me(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return my_account.account_json(db, principal.user)


@router.patch("/profile")
def update_profile(body: ProfileUpdate, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    user = my_account.update_profile(db, principal, body.full_name, body.email, body.clear_email, body.current_password)
    return my_account.account_json(db, user)


@router.post("/password")
def change_password(body: PasswordChangeBody, response: Response, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Change the password. Every other session is signed out; this one gets a fresh token."""
    user = my_account.change_password(db, principal, body.current_password, body.new_password, body.device_identifier)
    return {"changed": True, "access_token": start_session(response, user)}


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
    out = my_account.account_json(db, user)
    if user.session_epoch != before:
        out["access_token"] = start_session(response, user)
    return out


# ---------------- sessions & devices ----------------

@router.get("/sessions")
def list_sessions(
    device_identifier: Optional[str] = Query(None, max_length=64),
    principal: Principal = Depends(load_principal), db: Session = Depends(get_db),
):
    """This account's signed-in devices. Location is not shown: MilkOS doesn't resolve addresses to places."""
    return my_account.list_sessions(db, principal, device_identifier)


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: UUID, response: Response, device_identifier: Optional[str] = Query(None, max_length=64),
                   principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    current = my_account.revoke_session(db, principal, session_id, device_identifier)
    return {"revoked": True, "signed_out_here": current, "access_token": None if current else start_session(response, principal.user)}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(body: RevokeOthers, response: Response, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    count = my_account.revoke_other_sessions(db, principal, body.device_identifier)
    return {"revoked": count, "access_token": start_session(response, principal.user)}


@router.get("/security-events")
def my_security_events(limit: int = Query(50, ge=1, le=200), principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return [security_events.event_json(e) for e in security_events.for_user(db, principal.user.id, limit)]


# ---------------- two-step verification (TOTP) ----------------

@router.post("/mfa/setup")
def mfa_setup(body: PasswordConfirm, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Start enrolment: returns the secret ONCE (for the authenticator app). Not active until /mfa/enable."""
    return my_account.mfa_setup(db, principal, body.password)


@router.post("/mfa/enable")
def mfa_enable(body: MfaCode, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"enabled": True, "recovery_codes": my_account.mfa_enable(db, principal, body.code)}


@router.post("/mfa/disable")
def mfa_disable(body: MfaSensitive, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    my_account.mfa_disable(db, principal, body.password, body.code)
    return {"enabled": False}


@router.post("/mfa/recovery-codes")
def mfa_new_recovery_codes(body: MfaSensitive, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"recovery_codes": my_account.mfa_new_recovery_codes(db, principal, body.password, body.code)}
