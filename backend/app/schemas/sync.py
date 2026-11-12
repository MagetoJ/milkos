from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID
from pydantic import BaseModel

class SyncMutationIn(BaseModel):
    id: int
    client_tx_id: UUID
    action: Literal["CREATE_COLLECTION", "UPDATE_COLLECTION"]
    payload: dict[str, Any]
    created_at: datetime

class SyncPushRequest(BaseModel):
    mutations: list[SyncMutationIn]

class SyncMutationResult(BaseModel):
    queue_id: int
    client_tx_id: UUID
    server_id: Optional[UUID] = None
    status: Literal["ok", "error"]
    error: Optional[str] = None

class SyncPushResponse(BaseModel):
    results: list[SyncMutationResult]

class FarmerSyncOut(BaseModel):
    id: UUID
    member_number: str
    full_name: str
    phone: str
    route_id: Optional[UUID] = None
    cooperative_id: UUID
    updated_at: datetime

    class Config:
        from_attributes = True

class SyncPullResponse(BaseModel):
    farmers: list[FarmerSyncOut]
    server_time: datetime
