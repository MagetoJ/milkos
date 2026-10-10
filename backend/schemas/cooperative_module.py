"""Request bodies for the cooperative module (routers/cooperative.py)."""
import re
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError

from core.validation import (
    clean_text,
    normalize_county,
    normalize_email,
    normalize_national_id,
    normalize_phone,
    pydantic_field,
)

_CODE = re.compile(r"^[A-Z0-9][A-Z0-9\-_/]{1,49}$")


def normalize_code(value: str) -> str:
    code = re.sub(r"\s", "", value or "").upper()
    if not _CODE.match(code):
        raise ValueError("Use 2-50 letters, digits, '-', '_' or '/' (for example CTR-001).")
    return code


def _optional(normalizer, error_type: str):
    """Like pydantic_field, but blank / null means 'not provided'."""
    inner = pydantic_field(normalizer, error_type)

    def validate(value):
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return inner(value)

    return validate


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    return clean_text(value) or None if value is not None else None


def strong_password(value: str) -> str:
    if not any(char.isdigit() for char in value):
        raise PydanticCustomError("password", "Password must contain at least one digit.")
    if not any(char.isupper() for char in value):
        raise PydanticCustomError("password", "Password must contain at least one uppercase letter.")
    return value


class _Body(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


# ---------------- collection centres ----------------

CentreStatus = Literal["ACTIVE", "INACTIVE"]


class CentreCreate(_Body):
    name: str = Field(..., min_length=2, max_length=255)
    code: Optional[str] = None  # generated (CTR-001, CTR-002, ...) when left out
    county: Optional[str] = None  # defaults to the cooperative's county
    location_description: Optional[str] = Field(None, max_length=1000)
    manager_user_id: Optional[UUID] = None
    has_cooler: bool = False
    cooler_capacity_litres: Optional[float] = Field(None, gt=0, le=1_000_000)

    _name = field_validator("name")(clean_text)
    _code = field_validator("code")(_optional(normalize_code, "code"))
    _county = field_validator("county")(_optional(normalize_county, "county"))
    _location = field_validator("location_description")(_blank_to_none)


class CentreUpdate(_Body):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    code: Optional[str] = None
    county: Optional[str] = None
    location_description: Optional[str] = Field(None, max_length=1000)
    manager_user_id: Optional[UUID] = None
    has_cooler: Optional[bool] = None
    cooler_capacity_litres: Optional[float] = Field(None, gt=0, le=1_000_000)
    status: Optional[CentreStatus] = None

    _name = field_validator("name")(lambda v: clean_text(v) if v is not None else v)
    _code = field_validator("code")(_optional(normalize_code, "code"))
    _county = field_validator("county")(_optional(normalize_county, "county"))
    _location = field_validator("location_description")(_blank_to_none)


# ---------------- farmers ----------------

FarmerStatus = Literal["ACTIVE", "INACTIVE"]
PaymentMethod = Literal["MPESA", "BANK"]


class _FarmerExtras(_Body):
    """Farm and payout details shared by create and update."""
    number_of_cows: Optional[int] = Field(None, ge=0, le=100_000)
    payment_method: Optional[PaymentMethod] = None
    payment_account: Optional[str] = Field(None, max_length=100)  # M-Pesa number or bank account
    bank_name: Optional[str] = Field(None, max_length=100)

    _bank = field_validator("bank_name", "payment_account")(_blank_to_none)


class FarmerCreate(_FarmerExtras):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone: str
    national_id: Optional[str] = None
    village: Optional[str] = Field(None, max_length=150)
    centre_id: Optional[UUID] = None
    farmer_number: Optional[str] = None  # generated (F-0001, F-0002, ...) when left out
    # Only a superadmin chooses the cooperative; anyone else naming a different one is refused.
    cooperative_id: Optional[UUID] = None

    _names = field_validator("first_name", "last_name")(clean_text)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))
    _national_id = field_validator("national_id")(_optional(normalize_national_id, "national_id"))
    _number = field_validator("farmer_number")(_optional(normalize_code, "farmer_number"))
    _village = field_validator("village")(_blank_to_none)


class FarmerUpdate(_FarmerExtras):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = None
    national_id: Optional[str] = None
    village: Optional[str] = Field(None, max_length=150)
    centre_id: Optional[UUID] = None
    farmer_number: Optional[str] = None
    status: Optional[FarmerStatus] = None

    _names = field_validator("first_name", "last_name")(lambda v: clean_text(v) if v is not None else v)
    _phone = field_validator("phone")(_optional(normalize_phone, "phone"))
    _national_id = field_validator("national_id")(_optional(normalize_national_id, "national_id"))
    _number = field_validator("farmer_number")(_optional(normalize_code, "farmer_number"))
    _village = field_validator("village")(_blank_to_none)


# ---------------- team ----------------

TeamRole = Literal["MANAGER", "COLLECTOR"]


class TeamCreate(_Body):
    full_name: str = Field(..., min_length=3, max_length=255)
    email: Optional[EmailStr] = None  # required for managers; collectors may sign in with their phone
    phone: str
    role: TeamRole
    # No password: the person sets their own from the SMS activation link (services/accounts).

    _name = field_validator("full_name")(clean_text)
    _email = field_validator("email", mode="before")(lambda v: normalize_email(v) or None if isinstance(v, str) else v)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))


class TeamUpdate(_Body):
    full_name: Optional[str] = Field(None, min_length=3, max_length=255)
    phone: Optional[str] = None
    role: Optional[TeamRole] = None
    is_active: Optional[bool] = None
    # Administrators never set passwords: use POST /team/{id}/send-password-reset (a link to the person's phone).

    _name = field_validator("full_name")(lambda v: clean_text(v) if v is not None else v)
    _phone = field_validator("phone")(_optional(normalize_phone, "phone"))