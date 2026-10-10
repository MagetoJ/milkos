from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict
from enum import Enum
from pydantic_core import PydanticCustomError
from typing import Optional
from uuid import UUID

from core.validation import (
    clean_text,
    normalize_county,
    normalize_email,
    normalize_kra_pin,
    normalize_national_id,
    normalize_phone,
    normalize_registration_number,
    pydantic_field,
)

class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    COOP_ADMIN = "COOP_ADMIN"
    MANAGER = "MANAGER"
    COLLECTOR = "COLLECTOR"
    FARMER = "FARMER"

# --- Registration Input Validation ---

class CooperativeRegisterRequest(BaseModel):
    # Trims every string before the field validators below run.
    model_config = ConfigDict(str_strip_whitespace=True)

    # Organization Details
    cooperative_name: str = Field(..., min_length=3, max_length=255, description="Official Cooperative Name")
    registration_number: str = Field(..., description="Official Co-op Registration/License Number")
    kra_pin: str = Field(..., description="KRA PIN for verification")
    county: str = Field(..., description="County of operation")
    location: str = Field(..., min_length=2, max_length=255, description="Town/Sub-County address")

    # Primary Admin / Applicant Info
    admin_full_name: str = Field(..., min_length=3, max_length=255, description="Full Name of Primary Administrator")
    admin_email: EmailStr = Field(..., description="Official Email Address")
    admin_phone: str = Field(..., description="Phone Number")
    admin_id_number: str = Field(..., description="National ID Number")
    password: str = Field(..., min_length=8, max_length=64, description="Account Password")

    # Operational Details
    estimated_daily_liters: Optional[float] = Field(None, gt=0, le=10_000_000, description="Estimated daily milk volume in Liters")
    initial_coolers_count: Optional[int] = Field(1, ge=0, le=1000, description="Number of collection centers/coolers")
    additional_info: Optional[str] = Field(None, max_length=2000, description="Additional background information")

    _clean_names = field_validator("cooperative_name", "location", "admin_full_name")(clean_text)
    _email = field_validator("admin_email")(normalize_email)
    _phone = field_validator("admin_phone")(pydantic_field(normalize_phone, "phone"))
    _kra_pin = field_validator("kra_pin")(pydantic_field(normalize_kra_pin, "kra_pin"))
    _id_number = field_validator("admin_id_number")(pydantic_field(normalize_national_id, "national_id"))
    _county = field_validator("county")(pydantic_field(normalize_county, "county"))
    _reg_no = field_validator("registration_number")(
        pydantic_field(normalize_registration_number, "registration_number")
    )

    @field_validator("additional_info")
    @classmethod
    def blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return v or None

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not any(char.isdigit() for char in v):
            raise PydanticCustomError("password", "Password must contain at least one digit.")
        if not any(char.isupper() for char in v):
            raise PydanticCustomError("password", "Password must contain at least one uppercase letter.")
        return v

class CooperativeRegisterResponse(BaseModel):
    message: str
    application_id: str
    status: str

# --- Login Input Validation ---
class UserLogin(BaseModel):
    """Sign in with an email address or a phone number. `email` is kept for older clients."""
    identifier: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)

    @property
    def login_identifier(self) -> str:
        return (self.identifier or self.email or "").strip()


def _password_rules(v: str) -> str:
    if len(v) < 8:
        raise PydanticCustomError("password", "Use at least 8 characters.")
    if not any(char.isdigit() for char in v):
        raise PydanticCustomError("password", "Password must contain at least one digit.")
    if not any(char.isupper() for char in v):
        raise PydanticCustomError("password", "Password must contain at least one uppercase letter.")
    if not any(char.islower() for char in v):
        raise PydanticCustomError("password", "Password must contain at least one lowercase letter.")
    return v


class TokenBody(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class ActivationOtpVerify(TokenBody):
    code: str = Field(..., min_length=4, max_length=10)


class PasswordSet(TokenBody):
    password: str = Field(..., max_length=128)
    _password = field_validator("password")(_password_rules)


class ResendActivation(BaseModel):
    token: Optional[str] = Field(None, max_length=200)
    identifier: Optional[str] = Field(None, max_length=255)


class ResetRequest(BaseModel):
    identifier: str = Field(..., min_length=3, max_length=255)


class MfaLogin(BaseModel):
    mfa_token: str = Field(..., min_length=10, max_length=2000)
    code: str = Field(..., min_length=6, max_length=20)


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., max_length=128)
    _password = field_validator("new_password")(_password_rules)

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