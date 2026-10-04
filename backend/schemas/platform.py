"""Request bodies for platform administration (routers/superadmin/*) and shared operations
(collectors, coolers, milk collections, SMS credits).

Bodies may carry `cooperative_id`. Only a superadmin may choose it; for everyone else the services
use the caller's own cooperative and refuse (403) a different one. See core.access.
"""
import datetime as dt
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from core.validation import (
    clean_text,
    normalize_county,
    normalize_email,
    normalize_kra_pin,
    normalize_phone,
    normalize_registration_number,
    pydantic_field,
)
from schemas.auth import UserRole
from schemas.cooperative_module import _blank_to_none, _optional, normalize_code, strong_password


class _Body(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


def _clean_optional(value: Optional[str]) -> Optional[str]:
    return clean_text(value) if value is not None else None


ActiveStatus = Literal["ACTIVE", "INACTIVE"]


class StatusChange(_Body):
    status: ActiveStatus
    reason: Optional[str] = Field(None, max_length=500)


# ---------------- cooperatives ----------------

class CooperativeAdminAccount(_Body):
    full_name: str = Field(..., min_length=3, max_length=255)
    email: EmailStr
    phone: str
    password: str = Field(..., min_length=8, max_length=64)

    _name = field_validator("full_name")(clean_text)
    _email = field_validator("email")(normalize_email)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))
    _password = field_validator("password")(strong_password)


class CooperativeCreate(_Body):
    name: str = Field(..., min_length=3, max_length=255)
    registration_number: str
    kra_pin: str
    county: str
    location: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    estimated_daily_liters: Optional[float] = Field(None, gt=0, le=10_000_000)
    admin: Optional[CooperativeAdminAccount] = None  # creates the cooperative's first COOP_ADMIN

    _name = field_validator("name")(clean_text)
    _reg = field_validator("registration_number")(pydantic_field(normalize_registration_number, "registration_number"))
    _kra = field_validator("kra_pin")(pydantic_field(normalize_kra_pin, "kra_pin"))
    _county = field_validator("county")(pydantic_field(normalize_county, "county"))
    _location = field_validator("location")(_blank_to_none)
    _email = field_validator("contact_email", mode="before")(lambda v: normalize_email(v) if isinstance(v, str) and v.strip() else None)
    _phone = field_validator("contact_phone")(_optional(normalize_phone, "phone"))


class CooperativeUpdate(_Body):
    name: Optional[str] = Field(None, min_length=3, max_length=255)
    registration_number: Optional[str] = None
    kra_pin: Optional[str] = None
    county: Optional[str] = None
    location: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    estimated_daily_liters: Optional[float] = Field(None, gt=0, le=10_000_000)

    _name = field_validator("name")(_clean_optional)
    _reg = field_validator("registration_number")(_optional(normalize_registration_number, "registration_number"))
    _kra = field_validator("kra_pin")(_optional(normalize_kra_pin, "kra_pin"))
    _county = field_validator("county")(_optional(normalize_county, "county"))
    _location = field_validator("location")(_blank_to_none)
    _email = field_validator("contact_email", mode="before")(lambda v: normalize_email(v) if isinstance(v, str) and v.strip() else None)
    _phone = field_validator("contact_phone")(_optional(normalize_phone, "phone"))


class CooperativeStatusChange(_Body):
    status: Literal["ACTIVE", "SUSPENDED"]
    reason: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def reason_when_suspending(self):
        if self.status == "SUSPENDED" and len((self.reason or "").strip()) < 5:
            raise PydanticCustomError("reason", "Give a reason (at least 5 characters) when suspending a cooperative.")
        return self


class SmsCreditAdjustment(_Body):
    delta: int = Field(..., ge=-1_000_000, le=1_000_000)
    reason: str = Field(..., min_length=5, max_length=500)

    @field_validator("delta")
    @classmethod
    def non_zero(cls, v: int) -> int:
        if v == 0:
            raise PydanticCustomError("delta", "Enter a non-zero number of credits.")
        return v


# ---------------- users ----------------

class UserCreate(_Body):
    full_name: str = Field(..., min_length=3, max_length=255)
    email: EmailStr
    phone: str
    role: UserRole
    password: str = Field(..., min_length=8, max_length=64)
    cooperative_id: Optional[UUID] = None   # required for every role except SUPER_ADMIN
    farmer_id: Optional[UUID] = None        # FARMER accounts are linked to an existing farmer record

    _name = field_validator("full_name")(clean_text)
    _email = field_validator("email")(normalize_email)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))
    _password = field_validator("password")(strong_password)


class UserUpdate(_Body):
    full_name: Optional[str] = Field(None, min_length=3, max_length=255)
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    role: Optional[UserRole] = None
    cooperative_id: Optional[UUID] = None

    _name = field_validator("full_name")(_clean_optional)
    _email = field_validator("email", mode="before")(lambda v: normalize_email(v) if isinstance(v, str) else v)
    _phone = field_validator("phone")(_optional(normalize_phone, "phone"))


class UserStatusChange(_Body):
    is_active: bool
    reason: Optional[str] = Field(None, max_length=500)


class PasswordReset(_Body):
    password: str = Field(..., min_length=8, max_length=64)
    _password = field_validator("password")(strong_password)


# ---------------- collectors ----------------

class CollectorCreate(_Body):
    full_name: str = Field(..., min_length=3, max_length=255)
    email: EmailStr
    phone: str
    password: str = Field(..., min_length=8, max_length=64)
    cooperative_id: Optional[UUID] = None
    collector_number: Optional[str] = None  # generated (COL-001, ...) when left out
    assigned_area: Optional[str] = Field(None, max_length=255)
    centre_id: Optional[UUID] = None
    cooler_id: Optional[UUID] = None

    _name = field_validator("full_name")(clean_text)
    _email = field_validator("email")(normalize_email)
    _phone = field_validator("phone")(pydantic_field(normalize_phone, "phone"))
    _password = field_validator("password")(strong_password)
    _number = field_validator("collector_number")(_optional(normalize_code, "collector_number"))
    _area = field_validator("assigned_area")(_blank_to_none)


class CollectorUpdate(_Body):
    full_name: Optional[str] = Field(None, min_length=3, max_length=255)
    phone: Optional[str] = None
    collector_number: Optional[str] = None
    assigned_area: Optional[str] = Field(None, max_length=255)
    centre_id: Optional[UUID] = None
    cooler_id: Optional[UUID] = None
    status: Optional[ActiveStatus] = None

    _name = field_validator("full_name")(_clean_optional)
    _phone = field_validator("phone")(_optional(normalize_phone, "phone"))
    _number = field_validator("collector_number")(_optional(normalize_code, "collector_number"))
    _area = field_validator("assigned_area")(_blank_to_none)


# ---------------- coolers ----------------

class _CoolerAlerts(_Body):
    """Who is in charge and when to alert (services/cooler_alerts.py). Empty threshold = alert off."""
    manager_user_id: Optional[UUID] = None
    low_volume_alert_litres: Optional[float] = Field(None, ge=0, le=1_000_000)
    high_volume_alert_litres: Optional[float] = Field(None, ge=0, le=1_000_000)
    min_temperature_c: Optional[float] = Field(None, ge=-30, le=80)
    max_temperature_c: Optional[float] = Field(None, ge=-30, le=80)
    stale_after_minutes: Optional[int] = Field(None, ge=5, le=10_080)
    low_battery_percent: Optional[int] = Field(None, ge=1, le=99)
    alerts_enabled: Optional[bool] = None


class CoolerCreate(_CoolerAlerts):
    name: str = Field(..., min_length=2, max_length=255)
    code: Optional[str] = None  # generated (CLR-001, ...) when left out
    cooperative_id: Optional[UUID] = None
    centre_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=255)
    capacity_litres: Optional[float] = Field(None, gt=0, le=1_000_000)
    scale_device_id: Optional[str] = Field(None, max_length=255)
    is_operational: bool = True

    _name = field_validator("name")(clean_text)
    _code = field_validator("code")(_optional(normalize_code, "code"))
    _location = field_validator("location", "scale_device_id")(_blank_to_none)


class CoolerUpdate(_CoolerAlerts):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    code: Optional[str] = None
    centre_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=255)
    capacity_litres: Optional[float] = Field(None, gt=0, le=1_000_000)
    scale_device_id: Optional[str] = Field(None, max_length=255)
    is_operational: Optional[bool] = None
    status: Optional[ActiveStatus] = None
    last_temperature_c: Optional[float] = Field(None, ge=-30, le=60)

    _name = field_validator("name")(_clean_optional)
    _code = field_validator("code")(_optional(normalize_code, "code"))
    _location = field_validator("location", "scale_device_id")(_blank_to_none)


# ---------------- milk collections ----------------

QualityStatusIn = Literal["ACCEPTED", "REJECTED", "PENDING"]


class CollectionCreate(_Body):
    farmer_id: UUID
    cooperative_id: Optional[UUID] = None
    collector_id: Optional[UUID] = None  # a collector always records under their own profile
    cooler_id: Optional[UUID] = None
    collection_date: Optional[dt.date] = None  # defaults to today (UTC)
    collection_time: Optional[dt.time] = None  # defaults to now (UTC)
    quantity_litres: float = Field(..., gt=0, le=10_000)
    fat_percentage: Optional[float] = Field(None, ge=0, le=20)
    snf_percentage: Optional[float] = Field(None, ge=0, le=20)
    temperature_c: Optional[float] = Field(None, ge=-5, le=60)
    quality_status: Optional[QualityStatusIn] = None
    rejection_reason: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)

    _text = field_validator("rejection_reason", "notes")(_blank_to_none)

    @field_validator("collection_date")
    @classmethod
    def not_in_future(cls, v: Optional[dt.date]) -> Optional[dt.date]:
        if v is not None and v > dt.datetime.utcnow().date() + dt.timedelta(days=1):
            raise PydanticCustomError("collection_date", "A collection can't be dated in the future.")
        return v


class CollectionUpdate(_Body):
    cooler_id: Optional[UUID] = None
    quantity_litres: Optional[float] = Field(None, gt=0, le=10_000)
    fat_percentage: Optional[float] = Field(None, ge=0, le=20)
    snf_percentage: Optional[float] = Field(None, ge=0, le=20)
    temperature_c: Optional[float] = Field(None, ge=-5, le=60)
    quality_status: Optional[QualityStatusIn] = None
    rejection_reason: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)

    _text = field_validator("rejection_reason", "notes")(_blank_to_none)


# ---------------- payments / SMS credits ----------------

class PaymentDecision(_Body):
    action: Literal["VERIFY", "REJECT"]
    reason: Optional[str] = Field(None, max_length=500)


class SmsTopUpCreate(_Body):
    package_id: Optional[UUID] = None
    credits: Optional[int] = Field(None, gt=0, le=10_000_000)
    amount_kes: Optional[float] = Field(None, gt=0, le=100_000_000)
    mpesa_reference: str = Field(..., min_length=8, max_length=20)

    @field_validator("mpesa_reference")
    @classmethod
    def mpesa_code(cls, v: str) -> str:
        code = v.replace(" ", "").upper()
        if not code.isalnum():
            raise PydanticCustomError("mpesa_reference", "Enter the M-Pesa confirmation code, e.g. SJK3H2L9QX.")
        return code


class SmsPackageCreate(_Body):
    name: str = Field(..., min_length=2, max_length=100)
    credits_amount: int = Field(..., gt=0, le=10_000_000)
    price_kes: float = Field(..., gt=0, le=100_000_000)
    is_active: bool = True


class SmsPackageUpdate(_Body):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    credits_amount: Optional[int] = Field(None, gt=0, le=10_000_000)
    price_kes: Optional[float] = Field(None, gt=0, le=100_000_000)
    is_active: Optional[bool] = None


# ---------------- settings ----------------

class SettingsUpdate(_Body):
    values: dict[str, Any]
