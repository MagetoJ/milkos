"""Request bodies for milk pricing, farmer payments and the SMS credit center."""
import datetime as dt
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from schemas.cooperative_module import _blank_to_none


class _Body(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class PriceCreate(_Body):
    effective_from: dt.date
    effective_to: Optional[dt.date] = None  # empty = until the next price
    price_per_kg: float = Field(..., gt=0, le=100_000)
    notes: Optional[str] = Field(None, max_length=500)

    _notes = field_validator("notes")(_blank_to_none)

    @field_validator("price_per_kg")
    @classmethod
    def cents(cls, v: float) -> float:
        return round(v, 2)

    @model_validator(mode="after")
    def window(self):
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise PydanticCustomError("effective_to", "The end date must be on or after the start date.")
        return self


class Cancellation(_Body):
    reason: str = Field(..., min_length=5, max_length=500)


class PaymentGenerate(_Body):
    period_start: dt.date
    period_end: dt.date
    farmer_ids: Optional[list[UUID]] = Field(None, max_length=1000)

    @model_validator(mode="after")
    def period(self):
        if self.period_end < self.period_start:
            raise PydanticCustomError("period_end", "The period must end on or after its start.")
        if (self.period_end - self.period_start).days > 92:
            raise PydanticCustomError("period_end", "Generate payments for at most three months at a time.")
        if self.period_end > dt.datetime.utcnow().date():
            raise PydanticCustomError("period_end", "A payment period can't end in the future.")
        return self


class PaymentStatusChange(_Body):
    status: Literal["PROCESSING", "PAID", "FAILED", "CANCELLED"]
    payment_reference: Optional[str] = Field(None, min_length=4, max_length=100)
    reason: Optional[str] = Field(None, max_length=500)

    _reason = field_validator("reason")(_blank_to_none)


class SmsSettingsUpdate(_Body):
    receipt_sms_enabled: Optional[bool] = None
    alert_sms_enabled: Optional[bool] = None


class SmsCreditAdjustmentIn(_Body):
    delta: int = Field(..., ge=-10_000_000, le=10_000_000)
    reason: str = Field(..., min_length=5, max_length=500)

    @field_validator("delta")
    @classmethod
    def nonzero(cls, v: int) -> int:
        if v == 0:
            raise PydanticCustomError("delta", "Enter a non-zero number of credits.")
        return v
