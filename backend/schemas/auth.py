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

class CooperativeRegisterRequest(BaseModel):
    # Organization Details
    cooperative_name: str = Field(..., min_length=3, description="Official Cooperative Name")
    registration_number: str = Field(..., description="Official Co-op Registration/License Number")
    kra_pin: str = Field(..., description="KRA PIN for verification")
    county: str = Field(..., description="County of operation")
    location: str = Field(..., description="Town/Sub-County address")
    
    # Primary Admin / Applicant Info
    admin_full_name: str = Field(..., min_length=3, description="Full Name of Primary Administrator")
    admin_email: EmailStr = Field(..., description="Official Email Address")
    admin_phone: str = Field(..., description="Phone Number")
    admin_id_number: str = Field(..., description="National ID Number")
    password: str = Field(..., min_length=8, max_length=64, description="Account Password")

    # Operational Details
    estimated_daily_liters: Optional[float] = Field(None, description="Estimated daily milk volume in Liters")
    initial_coolers_count: Optional[int] = Field(1, description="Number of collection centers/coolers")
    additional_info: Optional[str] = Field(None, description="Additional background information")

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not any(char.isdigit() for char in v):
            raise ValueError("Password must contain at least one digit.")
        if not any(char.isupper() for char in v):
            raise ValueError("Password must contain at least one uppercase letter.")
        return v

class CooperativeRegisterResponse(BaseModel):
    message: str
    application_id: str
    status: str

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

    model_config = ConfigDict(from_attributes=True)