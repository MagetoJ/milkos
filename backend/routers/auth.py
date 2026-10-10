import logging
import os
from datetime import datetime
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from db import get_db
from models.user import AccountStatus, User
from models.admin import CooperativeApplication
from schemas.auth import (
    ActivationOtpVerify, CooperativeRegisterRequest, CooperativeRegisterResponse, MfaLogin, PasswordSet, ResendActivation,
    ResetRequest, TokenBody, UserLogin, UserRole,
)
from core import ratelimit
from core.security import (
    access_token_for, constant_time_equals, create_purpose_token, decode_access_token, decode_purpose_token,
    hash_password, verify_password,
)
from core.notifications import notify_applicant
from core.onboarding import detect_flags, find_conflict

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])
logger = logging.getLogger("milkflow.auth")
# Set COOKIE_SECURE=true behind HTTPS so the session cookie is never sent over plain HTTP.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


def _svc():
    """services.accounts / services.security_events (imported late: services import this module)."""
    from services import accounts, security_events

    return accounts, security_events


def conflict_error(field: Optional[str], message: str) -> HTTPException:
    """409 shaped like FastAPI's 422 body, so the client maps both to form fields the same way."""
    loc = ["body", field] if field else ["body"]
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=[{"loc": loc, "msg": message, "type": "conflict"}],
    )


# 1. Custom token extractor checking Cookies and Authorization header
def get_token_from_request(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return token


# 2. Extract current user payload from token
def get_current_user(token: str = Depends(get_token_from_request)) -> dict:
    payload = decode_access_token(token)
    if not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    return payload


# 3. Role Checker Dependency (imported by superadmin.py)
def require_roles(allowed_roles: list[UserRole]):
    allowed_values = {role.value for role in allowed_roles}

    def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action",
            )
        return current_user

    return role_checker


# 4. Public Cooperative Onboarding Application Registration
@router.post("/register", response_model=CooperativeRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_cooperative_application(
    payload: CooperativeRegisterRequest, 
    db: Session = Depends(get_db)
):
    """
    Public registration endpoint reserved exclusively for Cooperative Onboarding.
    Individual roles (Managers, Collectors, Farmers) cannot self-register here;
    they are created by the Cooperative Admin upon approval.
    """
    from services import settings  # local: services import this module

    if not settings.get(db, "onboarding.accepting_applications"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Milkflow is not accepting new cooperative applications right now. Please try again later.",
        )
    # The payload is already normalised (phone in E.164, uppercase KRA PIN, canonical county...).
    conflict = find_conflict(db, payload)
    if conflict:
        raise conflict_error(*conflict)
    flags = detect_flags(db, payload)

    try:
        # Create inactive COOP_ADMIN user account pending Superadmin approval
        coop_admin_user = User(
            email=payload.admin_email,
            password_hash=hash_password(payload.password),
            full_name=payload.admin_full_name,
            phone_number=payload.admin_phone,
            role=UserRole.COOP_ADMIN,
            password_set_at=datetime.utcnow(),
        )
        # Remains unable to sign in until a superadmin approves the application.
        coop_admin_user.set_status(AccountStatus.PENDING_APPROVAL)
        db.add(coop_admin_user)
        db.flush()  # Generate user ID

        new_app = CooperativeApplication(
            org_name=payload.cooperative_name,
            applicant_name=payload.admin_full_name,
            email=payload.admin_email,
            phone=payload.admin_phone,
            location=f"{payload.location}, {payload.county}",
            status="PENDING",
            registration_number=payload.registration_number,
            kra_pin=payload.kra_pin,
            county=payload.county,
            sub_county=payload.location,
            admin_id_number=payload.admin_id_number,
            estimated_daily_liters=payload.estimated_daily_liters,
            initial_coolers_count=payload.initial_coolers_count,
            additional_info=payload.additional_info,
            admin_user_id=coop_admin_user.id,
            flags=flags,
        )
        db.add(new_app)
        db.flush()
        from services import inbox

        inbox.platform(
            db, category="SYSTEM", type="APPLICATION_SUBMITTED", title=f"New cooperative application: {payload.cooperative_name}",
            body=f"{payload.admin_full_name}, {payload.county}" + (f" ({len(flags)} flag(s) to check)" if flags else ""),
            severity="WARNING" if flags else "INFO", entity_type="application", entity_id=new_app.id,
            link="/superadmin/onboarding",
        )
        db.commit()
    except IntegrityError:
        # A simultaneous submission won the race for a unique value (email, phone, reg. no., KRA PIN).
        db.rollback()
        raise conflict_error(*(find_conflict(db, payload) or (
            None, "An application with these details was just submitted. Refresh and check before trying again."
        )))
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Cooperative registration failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't save your application. Please try again in a few minutes."
        )

    notify_applicant(new_app, "APPLICATION_RECEIVED")
    return CooperativeRegisterResponse(
        message="Cooperative application submitted successfully. Pending administrative approval.",
        application_id=str(new_app.id),
        status="PENDING"
    )


def _client(request: Request) -> tuple[Optional[str], Optional[str]]:
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip()[:64] if forwarded else (request.client.host[:64] if request.client else None)
    return ip, (request.headers.get("user-agent") or "")[:500] or None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=15 * 60, path="/",
    )


def _blocked(code: str, message: str, http_status: int = 403) -> HTTPException:
    # `detail` stays a plain string (clients show it as-is); the machine-readable code travels in a header.
    return HTTPException(status_code=http_status, detail=message, headers={"X-Error-Code": code})


def _finish_login(db: Session, user: User, response: Response, ip, ua, method: str = "password") -> dict:
    _, security_events = _svc()
    user.last_login_at = datetime.utcnow()
    user.failed_login_count = 0
    user.locked_until = None
    security_events.record(db, "LOGIN_SUCCESS", user=user, ip_address=ip, user_agent=ua, details={"method": method})
    db.commit()
    token = access_token_for(user)
    set_session_cookie(response, token)
    return {
        "message": "Login successful",
        "access_token": token,
        "role": user.role_value,
        "user_id": str(user.id),
        "must_change_password": bool(user.must_change_password),
    }


@router.post("/login")
def login(credentials: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    """Sign in with an email address or phone number, plus the password. Accounts with two-step verification
    receive an `mfa_token` to exchange at /auth/mfa/verify instead of an access token."""
    accounts, security_events = _svc()
    ratelimit.hit(request, "login", limit=30, window_seconds=300)
    ip, ua = _client(request)
    identifier = credentials.login_identifier
    user = accounts.find_by_identifier(db, identifier) if identifier else None
    if user is None:
        verify_password(credentials.password, _DUMMY_HASH)  # same work either way: no account-existence timing hint
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if accounts.is_locked(user):
        raise _blocked("locked", "Too many failed sign-in attempts. Try again in a few minutes or reset your password.", 429)
    if user.status_value == AccountStatus.PENDING_ACTIVATION:
        # No password exists yet: point the person at their activation link.
        _, code, message = accounts.login_block_reason(user)
        raise _blocked(code, message)
    if not verify_password(credentials.password, user.password_hash):
        accounts.note_failed_login(db, user, ip, ua)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    blocked = accounts.login_block_reason(user)
    if blocked:
        security_events.record(db, "LOGIN_BLOCKED", user=user, ip_address=ip, user_agent=ua, details={"status": user.status_value})
        db.commit()
        raise _blocked(blocked[1], blocked[2], blocked[0])
    if user.mfa_enabled:
        return {
            "mfa_required": True,
            "mfa_token": create_purpose_token(str(user.id), "mfa", minutes=5, sv=int(user.session_epoch or 0)),
            "message": "Enter the 6-digit code from your authenticator app.",
        }
    return _finish_login(db, user, response, ip, ua)


@router.post("/mfa/verify")
def mfa_verify(body: MfaLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    """Second sign-in step: a code from the authenticator app, or one unused recovery code."""
    from services import mfa

    accounts, security_events = _svc()
    ratelimit.hit(request, "mfa", limit=20, window_seconds=300)
    ip, ua = _client(request)
    payload = decode_purpose_token(body.mfa_token, "mfa")
    user = None
    if payload:
        try:
            user = db.get(User, UUID(payload["sub"]))
        except (ValueError, KeyError):
            user = None
    if user is None or not user.mfa_enabled or int(payload.get("sv", -1)) != int(user.session_epoch or 0):
        raise HTTPException(status_code=401, detail="Your sign-in has expired. Start again.")
    if accounts.is_locked(user):
        raise _blocked("locked", "Too many failed sign-in attempts. Try again in a few minutes.", 429)
    blocked = accounts.login_block_reason(user)
    if blocked:
        raise _blocked(blocked[1], blocked[2], blocked[0])
    code = body.code.strip()
    method = "mfa"
    if not mfa.verify_totp(mfa.decrypt(user.mfa_secret_encrypted), code):
        remaining = mfa.use_recovery_code(user.mfa_recovery_codes, code)
        if remaining is None:
            security_events.record(db, "MFA_CHALLENGE_FAILED", user=user, ip_address=ip, user_agent=ua)
            accounts.note_failed_login(db, user, ip, ua)
            raise HTTPException(status_code=400, detail="That code is not right.")
        user.mfa_recovery_codes = remaining
        method = "recovery_code"
        security_events.record(db, "MFA_RECOVERY_CODE_USED", user=user, ip_address=ip, user_agent=ua,
                               details={"codes_left": len(remaining)})
    return _finish_login(db, user, response, ip, ua, method)


def _session_user(db: Session, current_user: dict) -> User:
    try:
        user = db.get(User, UUID(current_user["sub"]))
    except (ValueError, KeyError):
        user = None
    # A revoked session (older epoch), a deactivated account or a changed role can't be carried forward.
    if not user or not user.is_active or int(current_user.get("sv", 0)) != int(user.session_epoch or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive")
    return user


@router.post("/refresh")
def refresh_token(response: Response, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user = _session_user(db, current_user)
    new_token = access_token_for(user)
    set_session_cookie(response, new_token)
    return {"access_token": new_token, "role": user.role_value, "user_id": str(user.id)}


@router.get("/me")
def get_my_profile(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from core.permissions import permissions_for

    user = _session_user(db, current_user)
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
        "permissions": sorted(p.value for p in permissions_for(role)),
    }


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _, security_events = _svc()
    token = request.cookies.get("access_token") or (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    if token:
        try:
            user = db.get(User, UUID(decode_access_token(token)["sub"]))
            if user is not None:
                ip, ua = _client(request)
                security_events.record(db, "LOGOUT", user=user, ip_address=ip, user_agent=ua)
                db.commit()
        except (HTTPException, ValueError, KeyError):
            pass
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out successfully"}


# ---------------- account activation (public: the person holds only the SMS link) ----------------

@router.post("/activation/inspect")
def activation_inspect(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    """What the activation page may show for this link. Account details only for a valid, unused link."""
    accounts, _ = _svc()
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    return accounts.inspect_activation(db, body.token, ip=ip, ua=ua)


@router.post("/activation/send-code")
def activation_send_code(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    accounts, _ = _svc()
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
    accounts, _ = _svc()
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    accounts.activation_verify_otp(db, body.token, body.code, ip=ip, ua=ua)
    return {"verified": True}


@router.post("/activation/complete")
def activation_complete(body: PasswordSet, request: Request, db: Session = Depends(get_db)):
    """Set the account's first password. The account becomes ACTIVE; the person then signs in normally."""
    accounts, _ = _svc()
    ratelimit.hit(request, "activation", limit=60, window_seconds=300)
    ip, ua = _client(request)
    user = accounts.complete_activation(db, body.token, body.password, ip=ip, ua=ua)
    return {"activated": True, "role": user.role_value, "message": "Your account is active. Sign in with your new password."}


@router.post("/activation/resend")
def activation_resend(body: ResendActivation, request: Request, db: Session = Depends(get_db)):
    accounts, _ = _svc()
    ratelimit.hit(request, "activation-resend", limit=10, window_seconds=3600)
    ip, ua = _client(request)
    pending = accounts.public_resend_activation(db, token=body.token, identifier=body.identifier, ip=ip, ua=ua)
    accounts.dispatch(db, pending, ip=ip, ua=ua)
    return {"message": accounts.GENERIC_RESEND}


# ---------------- password reset (public; ACTIVE accounts only, separate from activation) ----------------

@router.post("/password-reset/request")
def password_reset_request(body: ResetRequest, request: Request, db: Session = Depends(get_db)):
    accounts, _ = _svc()
    ratelimit.hit(request, "reset", limit=10, window_seconds=3600)
    ip, ua = _client(request)
    accounts.dispatch(db, accounts.request_password_reset(db, body.identifier, ip=ip, ua=ua))
    return {"message": accounts.GENERIC_RESET}


@router.post("/password-reset/inspect")
def password_reset_inspect(body: TokenBody, request: Request, db: Session = Depends(get_db)):
    accounts, _ = _svc()
    ratelimit.hit(request, "reset-check", limit=60, window_seconds=300)
    return accounts.inspect_reset(db, body.token)


@router.post("/password-reset/complete")
def password_reset_complete(body: PasswordSet, request: Request, db: Session = Depends(get_db)):
    accounts, _ = _svc()
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
    not_found = HTTPException(status_code=404, detail="No application matches this reference and email.")
    try:
        app_id = UUID(body.reference.strip())
    except ValueError:
        raise not_found
    record = db.get(CooperativeApplication, app_id)
    if record is None or not constant_time_equals((record.email or "").lower(), body.email.strip().lower()):
        raise not_found
    return {
        "status": record.status,
        "organisation": record.org_name,
        "submitted_at": record.created_at.isoformat() + "Z" if record.created_at else None,
        "reviewed_at": record.reviewed_at.isoformat() + "Z" if record.reviewed_at else None,
        "rejection_reason": record.rejection_reason if record.status == "REJECTED" else None,
    }


# ---------------- SMS delivery reports (provider -> MilkOS) ----------------

@router.post("/sms/delivery-report", include_in_schema=False)
async def sms_delivery_report(request: Request, db: Session = Depends(get_db)):
    """Africa's Talking delivery-report callback (form fields id, status, failureReason), protected by the shared
    SMS_DELIVERY_REPORT_TOKEN (?token=...). Answers 404 while that variable isn't set."""
    from services import notifications

    expected = os.getenv("SMS_DELIVERY_REPORT_TOKEN", "")
    supplied = request.query_params.get("token", "")
    if not expected or not constant_time_equals(supplied, expected):
        raise HTTPException(status_code=404, detail="Not found")
    from urllib.parse import parse_qs

    # Parsed by hand: a urlencoded body needs no extra dependency.
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode("utf-8", "replace")).items()}
    message_id = str(form.get("id") or "")
    if not message_id:
        raise HTTPException(status_code=422, detail="id is required")
    state = str(form.get("status") or "")
    notifications.record_delivery_report(db, message_id, state == "Success", str(form.get("failureReason") or state) or None)
    return {"ok": True}


GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
# Public URL of the web app. Google is sent back through it (Next proxies /api/v1 to this
# backend), so the session cookie and the final redirect both land on the app's own origin.
APP_URL = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", f"{APP_URL}/api/v1/auth/google/callback")

@router.get("/google/login")
def google_login():
    """Redirects user to Google OAuth consent screen."""
    google_auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"response_type=code&client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}&scope=openid%20email%20profile"
    )
    return RedirectResponse(url=google_auth_url)


@router.get("/google/callback")
async def google_callback(code: str, response: Response, db: Session = Depends(get_db)):
    """Handles Google OAuth callback, verifies user, and sets JWT session cookie."""
    import httpx

    # Exchange authorization code for token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient() as client:
        res = await client.post(token_url, data=data)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to authenticate with Google")
        token_data = res.json()

        # Fetch user info from Google
        user_info_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"}
        )
        if user_info_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch Google profile")
        
        google_profile = user_info_res.json()

    email = google_profile.get("email", "").lower()
    
    # Lookup existing user
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No account associated with this Google email. Please register your cooperative first."
        )

    accounts, security_events = _svc()
    blocked = accounts.login_block_reason(user)
    if blocked:
        raise HTTPException(status_code=blocked[0], detail=blocked[2])
    if user.mfa_enabled:
        # Google proves the email address, not the second factor: finish with password + code instead.
        return RedirectResponse(url=f"{APP_URL}/login?mfa_required=1")

    access_token = access_token_for(user)
    user.last_login_at = datetime.utcnow()
    security_events.record(db, "LOGIN_SUCCESS", user=user, details={"method": "google"})
    db.commit()

    redirect_res = RedirectResponse(url=f"{APP_URL}/login?google_success=1")
    redirect_res.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=15 * 60,
        path="/"
    )
    return redirect_res