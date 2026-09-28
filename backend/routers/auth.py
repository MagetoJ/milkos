from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from schemas.auth import UserRegister, UserLogin, TokenResponse, UserResponse, UserRole
from core.security import hash_password, verify_password, create_access_token, decode_access_token

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Dependency to retrieve and validate current user
async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    return payload  # Returns token payload containing user_id and role

# Dependency for Role-Based Access Control
def require_roles(allowed_roles: list[UserRole]):
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role")
        allowed_values = {role.value for role in allowed_roles}
        if user_role not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action"
            )
        return current_user
    return role_checker

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserRegister, db: Session = Depends(get_db)):
    if user_in.role not in {UserRole.FARMER, UserRole.COLLECTOR}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This role must be assigned by a cooperative administrator",
        )

    email = user_in.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(user_in.password),
        full_name=user_in.full_name,
        phone_number=user_in.phone_number,
        role=user_in.role,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from error
    db.refresh(user)
    return user

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email.lower()).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": role,
    }
    access_token = create_access_token(data=token_payload)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": role,
        "user_id": str(user.id),
    }

@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return {"status": "active", "user": current_user}