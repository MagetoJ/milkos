from __future__ import annotations


from pydantic import BaseModel, EmailStr, Field


class CooperativeCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    registration_number: str = Field(..., min_length=2, max_length=100)
    kra_pin: str | None = Field(default=None, min_length=5, max_length=20)
    county: str = Field(..., min_length=2, max_length=100)
    location: str | None = Field(default=None, max_length=255)
    status: str = "ACTIVE"
    estimated_daily_liters: float | None = None


class CooperativeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    county: str | None = Field(default=None, min_length=2, max_length=100)
    location: str | None = Field(default=None, max_length=255)
    status: str | None = None
    estimated_daily_liters: float | None = None
    email: EmailStr | None = None
    phone: str | None = None
