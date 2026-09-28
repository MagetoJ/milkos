from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from schemas.auth import UserRegister, UserLogin, TokenResponse, UserResponse, UserRole
from core.security import hash_password, verify_password, create_access_token, decode_access_token
# Import your database session getter (get_db) and User model here
# from db import get_db, User

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
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action"
            )
        return current_user
    return role_checker

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserRegister):
    # 1. Check if user already exists (mock database check)
    # existing_user = db.query(User).filter(User.email == user_in.email).first()
    # if existing_user:
    #     raise HTTPException(status_code=400, detail="Email already registered")

    # 2. Hash password & store user
    hashed_pwd = hash_password(user_in.password)
    
    # mock_created_user = User(...)
    return {
        "id": "usr_12345",
        "email": user_in.email,
        "full_name": user_in.full_name,
        "phone_number": user_in.phone_number,
        "role": user_in.role,
        "is_active": True
    }

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    # 1. Fetch user from DB
    # user = db.query(User).filter(User.email == credentials.email).first()
    # if not user or not verify_password(credentials.password, user.password_hash):
    #     raise HTTPException(status_code=400, detail="Incorrect email or password")

    # Mock Validation
    if credentials.email != "admin@milkflow.com" or credentials.password != "Password123":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    # 2. Create JWT Token
    token_payload = {
        "sub": "usr_12345",
        "email": credentials.email,
        "role": UserRole.ADMIN
    }
    access_token = create_access_token(data=token_payload)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": UserRole.ADMIN,
        "user_id": "usr_12345"
    }

@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return {"status": "active", "user": current_user}