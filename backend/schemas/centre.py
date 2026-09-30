from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class CentreCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    code: str = Field(..., min_length=2, max_length=50)
    county: str = Field(..., min_length=2, max_length=100)
    location_description: str | None = None
    manager_user_id: uuid.UUID | None = None
    has_cooler: bool = False
    cooler_capacity_litres: float | None = None


class CentreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    county: str | None = Field(default=None, min_length=2, max_length=100)
    location_description: str | None = None
    manager_user_id: uuid.UUID | None = None
    has_cooler: bool | None = None
    cooler_capacity_litres: float | None = None
    status: str | None = None


class CentreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cooperative_id: uuid.UUID
    name: str
    code: str
    county: str
    location_description: str | None = None
    manager_user_id: uuid.UUID | None = None
    has_cooler: bool
    cooler_capacity_litres: float | None = None
    status: str
