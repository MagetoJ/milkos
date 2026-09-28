from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from schemas.auth import UserLogin, UserRole
from core.security import hash_password, verify_password, create_access_token, decode_access_token

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


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


@router.post("/login")
def login(credentials: UserLogin, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email.lower()).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

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
    new_token = create_access_token(
        data={
            "sub": current_user["sub"],
            "email": current_user.get("email"),
            "role": current_user.get("role"),
        }
    )

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
        "role": current_user.get("role"),
        "user_id": current_user["sub"],
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