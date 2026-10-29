"""Signing in and out, account activation, password reset and the public cooperative application:
/api/v1/auth. Rules live in app.services.authentication, accounts and onboarding; this module handles HTTP."""
import os
from datetime import timedelta
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.cookies import clear_session_cookie, set_session_cookie
from app.api.dependencies.auth import get_current_user, token_from_request
from app.api.dependencies.db import get_db
from app.core import ratelimit
from app.core.client import client_ip, user_agent
from app.core.config import get_settings
from app.core.security import constant_time_equals
from app.domain.exceptions import InvalidRequest, NotFound, ValidationFailed
from app.domain.schemas.auth import (
    ActivationOtpVerify, CooperativeRegisterRequest, CooperativeRegisterResponse, MfaLogin, PasswordSet,
    ResendActivation, ResetRequest, TokenBody, UserLogin,
)
from app.infrastructure.gateways import google_oauth
from app.services import accounts, authentication, notifications, onboarding

settings = get_settings()

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)  # 15 minutes


def _client(request: Request) -> tuple:
    return client_ip(request), user_agent(request)


@router.post("/register", response_model=CooperativeRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_cooperative_application(payload: CooperativeRegisterRequest, db: Session = Depends(get_db)):
    """Public registration, reserved for cooperative onboarding. Managers, collectors and farmers can't
    self-register; the cooperative admin creates them after approval."""
    application = onboarding.submit_application(db, payload)
    return CooperativeRegisterResponse(
        message="Cooperative application submitted successfully. Pending administrative approval.",
        application_id=str(application.id),
        status="PENDING",
    )


def _signed_in(response: Response, sign_in: authentication.SignIn) -> dict:
    if sign_in.token:
        set_session_cookie(response, sign_in.token)
    return sign_in.json()


@router.post("/login")
def login(credentials: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    """Sign in with an email address or phone number, plus the password. Accounts with two-step verification
    receive an `mfa_token` to exchange at /auth/mfa/verify instead of an access token."""
    ratelimit.hit(request, "login", limit=30, window_seconds=300)
    ip, ua = _client(request)
    return _signed_in(response, authentication.password_login(db, credentials.login_identifier, credentials.password, ip, ua))


@router.post("/mfa/verify")
def mfa_verify(body: MfaLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    """Second sign-in step: a code from the authenticator app, or one unused recovery code."""
    ratelimit.hit(request, "mfa", limit=20, window_seconds=300)
    ip, ua = _client(request)
    return _signed_in(response, authentication.mfa_login(db, body.mfa_token, body.code, ip, ua))


@router.post("/refresh")
def refresh_token(response: Response, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user, token = authentication.refresh(db, current_user)
    set_session_cookie(response, token)
    return {"access_token": token, "role": user.role_value, "user_id": str(user.id)}


@router.get("/me")
def get_my_profile(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return authentication.profile(db, current_user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    authentication.logout(db, token_from_request(request), *_client(request))
    clear_session_cookie(response)
    return {"message": "Logged out successfully"}


# ---------------- account activation (public: the person holds only the SMS link) ----------------

@router.post("/activation/inspect")
def activation_inspect(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    """What the activation page may show for this link. Account details only for a valid, unused link."""
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    return accounts.inspect_activation(db, body.token, ip=ip, ua=ua)


@router.post("/activation/send-code")
def activation_send_code(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "activation-otp", limit=10, window_seconds=600)
    ip, ua = _client(request)
    pending, _otp = accounts.activation_send_otp(db, body.token, ip=ip, ua=ua)
    sms = accounts.sms_outcome(accounts.dispatch(db, pending, ip=ip, ua=ua))
    return {
        **sms,
        "expires_in_seconds": accounts.OTP_MINUTES * 60,
        "resend_after_seconds": accounts.OTP_RESEND_SECONDS,
        "message": "We sent a 6-digit code to your phone." if sms["sms_sent"]
        else "We couldn't send the code right now. Wait a minute and try again.",
    }


@router.post("/activation/verify-code")
def activation_verify_code(body: ActivationOtpVerify, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    accounts.activation_verify_otp(db, body.token, body.code, ip=ip, ua=ua)
    return {"verified": True}


@router.post("/activation/complete")
def activation_complete(body: PasswordSet, request: Request, db: Session = Depends(get_db)):
    """Set the account's first password. The account becomes ACTIVE; the person then signs in normally."""
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    user = accounts.complete_activation(db, body.token, body.password, ip=ip, ua=ua)
    return {"activated": True, "role": user.role_value, "message": "Your account is active. Sign in with your new password."}


@router.post("/activation/resend")
def activation_resend(body: ResendActivation, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "activation-resend", limit=10, window_seconds=3600)
    ip, ua = _client(request)
    pending = accounts.public_resend_activation(db, token=body.token, identifier=body.identifier, ip=ip, ua=ua)
    accounts.dispatch(db, pending, ip=ip, ua=ua)
    return {"message": accounts.GENERIC_RESEND}


# ---------------- password reset (public; ACTIVE accounts only, separate from activation) ----------------

@router.post("/password-reset/request")
def password_reset_request(body: ResetRequest, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "reset", limit=10, window_seconds=3600)
    ip, ua = _client(request)
    accounts.dispatch(db, accounts.request_password_reset(db, body.identifier, ip=ip, ua=ua))
    return {"message": accounts.GENERIC_RESET}


@router.post("/password-reset/inspect")
def password_reset_inspect(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "reset-check", limit=60, window_seconds=300)
    return accounts.inspect_reset(db, body.token)


@router.post("/password-reset/complete")
def password_reset_complete(body: PasswordSet, request: Request, db: Session = Depends(get_db)):
    ratelimit.hit(request, "reset-check", limit=60, window_seconds=300)
    ip, ua = _client(request)
    accounts.complete_reset(db, body.token, body.password, ip=ip, ua=ua)
    return {"reset": True, "message": "Your password has been changed. Sign in with the new one."}


# ---------------- cooperative application status (public) ----------------

class ApplicationStatusQuery(BaseModel):
    reference: str = Field(..., min_length=8, max_length=64)
    email: str = Field(..., min_length=3, max_length=255)


@router.post("/application-status")
def application_status(body: ApplicationStatusQuery, request: Request, db: Session = Depends(get_db)):
    """An applicant checks their cooperative application with the reference they were given AND the email they
    applied with. A wrong pair gets the same 'not found' as a missing one; only the status is returned."""
    ratelimit.hit(request, "application-status", limit=20, window_seconds=600)
    return onboarding.application_status(db, body.reference, body.email)


# ---------------- SMS delivery reports (provider -> MilkOS) ----------------

@router.post("/sms/delivery-report", include_in_schema=False)
async def sms_delivery_report(request: Request, db: Session = Depends(get_db)):
    """Africa's Talking delivery-report callback (form fields id, status, failureReason), protected by the shared
    SMS_DELIVERY_REPORT_TOKEN (?token=...). Answers 404 while that variable isn't set."""
    expected = os.getenv("SMS_DELIVERY_REPORT_TOKEN", "")
    supplied = request.query_params.get("token", "")
    if not expected or not constant_time_equals(supplied, expected):
        raise NotFound("Page", "Not found")
    # Parsed by hand: a urlencoded body needs no extra dependency.
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode("utf-8", "replace")).items()}
    message_id = str(form.get("id") or "")
    if not message_id:
        raise ValidationFailed("id is required")
    state = str(form.get("status") or "")
    notifications.record_delivery_report(db, message_id, state == "Success", str(form.get("failureReason") or state) or None)
    return {"ok": True}


@router.get("/google/login")
def google_login():
    """Redirects user to Google OAuth consent screen."""
    return RedirectResponse(url=google_oauth.consent_url())


@router.get("/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    """Handles Google OAuth callback, verifies user, and sets JWT session cookie."""
    try:
        email = await google_oauth.email_for_code(code)
    except google_oauth.GoogleAuthError as exc:
        raise InvalidRequest(str(exc))
    sign_in = authentication.google_login(db, email)
    if sign_in.token is None:
        # Google proves the email address, not the second factor: finish with password + code instead.
        return RedirectResponse(url=f"{google_oauth.APP_URL}/login?mfa_required=1")
    redirect = RedirectResponse(url=f"{google_oauth.APP_URL}/login?google_success=1")
    set_session_cookie(redirect, sign_in.token)
    return redirect