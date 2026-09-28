from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict
from enum import Enum
from typing import Optional
from uuid import UUID

class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    COOP_ADMIN = "COOP_ADMIN"
    MANAGER = "MANAGER"
    COLLECTOR = "COLLECTOR"
    FARMER = "FARMER"

# --- Registration Input Validation ---
class UserRegister(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=100)
    # CHANGED: 'regex' is now 'pattern' in Pydantic V2
    phone_number: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")  # E.164 phone format
    password: str = Field(..., min_length=8, max_length=64)
    role: UserRole = UserRole.FARMER
    cooperative_id: Optional[str] = None

    # CHANGED: '@validator' is now '@field_validator' in Pydantic V2
    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not any(char.isdigit() for char in v):
            raise ValueError("Password must contain at least one digit.")
        if not any(char.isupper() for char in v):
            raise ValueError("Password must contain at least one uppercase letter.")
        return v

# --- Login Input Validation ---
class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)

# --- Response Schemas ---
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str

class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    phone_number: str
    role: UserRole
    is_active: bool

    # CHANGED: ConfigDict syntax in Pydantic V2
    model_config = ConfigDict(from_attributes=True)