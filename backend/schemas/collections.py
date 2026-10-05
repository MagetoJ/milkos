"""Request bodies for collection batches, their allocation lines, corrections and reversals."""
import datetime as dt
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from schemas.cooperative_module import _blank_to_none

QualityStatusIn = Literal["ACCEPTED", "REJECTED", "PENDING"]
WeightSourceIn = Literal["SCALE", "MANUAL", "SIMULATED"]

MAX_BATCH_KG = 100_000
MAX_LINES = 200


class _Body(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


def _naive_utc(value: Optional[dt.datetime]) -> Optional[dt.datetime]:
    if value is not None and value.tzinfo is not None:
        value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return value


class AllocationIn(_Body):
    # Device-generated id of the allocation line (reused as the server id, like every offline create).
    id: Optional[UUID] = None
    farmer_id: UUID
    quantity_kg: float = Field(..., gt=0, le=MAX_BATCH_KG)

    @field_validator("quantity_kg")
    @classmethod
    def two_decimals(cls, v: float) -> float:
        return round(v, 2)


class _BatchContent(_Body):
    """What a batch says about the milk: shared by creation and by a correction's proposed values."""
    cooler_id: Optional[UUID] = None
    centre_id: Optional[UUID] = None
    collection_date: Optional[dt.date] = None
    collection_time: Optional[dt.time] = None
    captured_weight_kg: float = Field(..., gt=0, le=MAX_BATCH_KG)
    tare_weight_kg: Optional[float] = Field(None, ge=0, le=MAX_BATCH_KG)
    temperature_c: Optional[float] = Field(None, ge=-5, le=60)
    fat_percentage: Optional[float] = Field(None, ge=0, le=20)
    snf_percentage: Optional[float] = Field(None, ge=0, le=20)
    quality_status: Optional[QualityStatusIn] = None
    rejection_reason: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)
    allocations: list[AllocationIn] = Field(..., min_length=1, max_length=MAX_LINES)

    _text = field_validator("rejection_reason", "notes")(_blank_to_none)

    @field_validator("captured_weight_kg")
    @classmethod
    def captured_two_decimals(cls, v: float) -> float:
        return round(v, 2)

    @field_validator("collection_date")
    @classmethod
    def not_in_future(cls, v: Optional[dt.date]) -> Optional[dt.date]:
        if v is not None and v > dt.datetime.utcnow().date() + dt.timedelta(days=1):
            raise PydanticCustomError("collection_date", "A collection can't be dated in the future.")
        return v

    @model_validator(mode="after")
    def allocation_rules(self):
        farmers = [a.farmer_id for a in self.allocations]
        if len(set(farmers)) != len(farmers):
            raise PydanticCustomError("allocations", "Each farmer can appear only once in a collection.")
        # Compare in hundredths of a KG so float rounding never lets 0.01 KG too much through.
        allocated = sum(round(a.quantity_kg * 100) for a in self.allocations)
        if allocated > round(self.captured_weight_kg * 100):
            raise PydanticCustomError(
                "allocations",
                "The allocated weight ({allocated} KG) is more than the captured weight ({captured} KG).",
                {"allocated": f"{allocated / 100:.2f}", "captured": f"{self.captured_weight_kg:.2f}"},
            )
        return self


class BatchCreate(_BatchContent):
    """A confirmed collection: the captured weight and its allocation to farmers, saved in one step."""
    # Client-generated id: resending the same batch (double tap, lost response) returns the original.
    id: Optional[UUID] = None
    collector_id: Optional[UUID] = None  # staff may record for a collector; collectors always record as themselves
    cooperative_id: Optional[UUID] = None  # never trusted: must be the caller's own when given
    weight_source: WeightSourceIn
    scale_name: Optional[str] = Field(None, max_length=255)
    scale_identifier: Optional[str] = Field(None, max_length=255)
    started_at: Optional[dt.datetime] = None
    captured_at: Optional[dt.datetime] = None
    confirmed_at: Optional[dt.datetime] = None
    send_receipts: bool = True

    _names = field_validator("scale_name", "scale_identifier")(_blank_to_none)
    _times = field_validator("started_at", "captured_at", "confirmed_at")(_naive_utc)

    @model_validator(mode="after")
    def scale_details(self):
        if self.weight_source == "MANUAL" and (self.scale_identifier or self.scale_name):
            # A typed-in weight must never look like a scale reading.
            raise PydanticCustomError("weight_source", "A manually entered weight can't name a scale.")
        return self


class BatchCorrectionProposal(_BatchContent):
    """The complete corrected batch (same rules as a new one)."""


class CorrectionRequestCreate(_Body):
    reason: str = Field(..., min_length=5, max_length=1000)
    proposed: BatchCorrectionProposal


class ReversalRequestCreate(_Body):
    reason: str = Field(..., min_length=5, max_length=1000)


class RequestReview(_Body):
    comment: Optional[str] = Field(None, max_length=1000)

    _comment = field_validator("comment")(_blank_to_none)


class LabResult(_Body):
    """Completing a PENDING lab test on one allocation line (the only in-place change a line accepts)."""
    quality_status: Literal["ACCEPTED", "REJECTED"]
    fat_percentage: Optional[float] = Field(None, ge=0, le=20)
    snf_percentage: Optional[float] = Field(None, ge=0, le=20)
    rejection_reason: Optional[str] = Field(None, max_length=500)

    _text = field_validator("rejection_reason")(_blank_to_none)
