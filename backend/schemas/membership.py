from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


class MembershipCreate(BaseModel):
    user_id: uuid.UUID
    role: str


class MembershipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cooperative_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    status: str
