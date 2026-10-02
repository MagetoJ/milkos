import logging
import os
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from models.admin import CooperativeApplication
from schemas.auth import UserLogin, UserRole, CooperativeRegisterRequest, CooperativeRegisterResponse
from core.security import hash_password, verify_password, create_access_token, decode_access_token
from core.notifications import notify_applicant
from core.onboarding import detect_flags, find_conflict

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])
logger = logging.getLogger("milkflow.auth")


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
            is_active=False  # Remains inactive until Superadmin approves application
        )
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


@router.post("/login")
def login(credentials: UserLogin, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email.lower()).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is pending approval or inactive")

    role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
    access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": role})

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=15 * 60,  # 15 minutes
        path="/"
    )

    return {
        "message": "Login successful",
        "access_token": access_token,
        "role": role,
        "user_id": str(user.id)
    }


@router.post("/refresh")
def refresh_token(
    current_user: dict = Depends(get_current_user),
    response: Response = None,
    db: Session = Depends(get_db)
):
    # Re-read the account so a deactivated user or a changed role can't be carried forward.
    try:
        user = db.get(User, UUID(current_user["sub"]))
    except (ValueError, KeyError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive")

    role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
    new_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": role})

    if response:
        response.set_cookie(
            key="access_token",
            value=new_token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=15 * 60,
            path="/"
        )

    return {
        "access_token": new_token,
        "role": role,
        "user_id": str(user.id),
    }


@router.get("/me")
def get_my_profile(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        user_id = UUID(current_user["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive")

    return {
        "user_id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value if isinstance(user.role, UserRole) else str(user.role),
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out successfully"}

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

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Account is pending approval or inactive."
        )

    role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
    access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": role})

    redirect_res = RedirectResponse(url=f"{APP_URL}/login?google_success=1")
    redirect_res.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=15 * 60,
        path="/"
    )
    return redirect_res