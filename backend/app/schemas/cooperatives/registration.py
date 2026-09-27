from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.cooperative import CooperativeStatus
from app.models.membership import MembershipRole
from app.models.registration import VerificationChannel

# Request bodies reject unknown fields, so a client cannot smuggle in
# server-owned values such as cooperative_id, status or applicant IDs.
_STRICT = ConfigDict(extra="forbid", str_strip_whitespace=True)


class StartVerificationRequest(BaseModel):
    model_config = _STRICT

    channel: VerificationChannel
    destination: str = Field(min_length=3, max_length=254)


class StartVerificationResponse(BaseModel):
    verification_id: UUID
    expires_at: datetime
    delivery: Literal["sent", "development_code"]
    # Only populated when EXPOSE_DEV_OTP is enabled outside production.
    code: str | None = None


class ConfirmVerificationRequest(BaseModel):
    model_config = _STRICT

    verification_id: UUID
    code: str = Field(pattern=r"^\d{6}$")


class ConfirmVerificationResponse(BaseModel):
    verified: bool
    verification_id: UUID


class SubmitApplicationRequest(BaseModel):
    model_config = _STRICT

    name: str = Field(min_length=2, max_length=200)
    registration_number: str | None = Field(default=None, max_length=64)
    email: str | None = Field(
        default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    )
    phone: str = Field(min_length=8, max_length=24)
    location: str | None = Field(default=None, max_length=200)
    # The verification completed by *this* user for `phone`.
    phone_verification_id: UUID


class ApplicationSubmittedResponse(BaseModel):
    application_id: UUID
    reference: str
    status: CooperativeStatus


class ApplicationStatusResponse(BaseModel):
    reference: str
    status: CooperativeStatus
    cooperative_name: str
    submitted_at: datetime
    reviewed_at: datetime | None
    notes: str | None
    requested_information: str | None


class AdminApplicationResponse(BaseModel):
    id: UUID
    reference: str
    status: CooperativeStatus
    cooperative_id: UUID
    cooperative_name: str
    registration_number: str | None
    applicant_user_id: UUID
    contact_phone: str
    contact_email: str | None
    location: str | None
    submitted_at: datetime
    reviewed_at: datetime | None
    notes: str | None


class ReviewApplicationRequest(BaseModel):
    model_config = _STRICT

    status: Literal["UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "REJECTED"]
    notes: str | None = Field(default=None, max_length=2000)


class CooperativeResponse(BaseModel):
    id: UUID
    name: str
    status: CooperativeStatus
    currency: str
    roles: list[MembershipRole]
