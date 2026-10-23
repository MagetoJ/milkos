"""In-app notification center: /api/v1/inbox. What a caller sees is decided by services/inbox.visible."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies.auth import load_principal
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.infrastructure.db.pagination import PageParams
from app.services import inbox
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1/inbox", tags=["Notification center"])


class MarkRead(BaseModel):
    ids: Optional[list[UUID]] = Field(None, max_length=500, description="Leave out to mark everything read.")


@router.get("")
def list_inbox(
    unread_only: bool = False,
    category: Optional[str] = Query(None, pattern="^(COOLER|SMS|COLLECTION|PAYMENT|SYNC|SYSTEM)$"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(load_principal),
    db: Session = Depends(get_db),
):
    return inbox.list_page(db, principal, unread_only, category, params)


@router.get("/count")
def unread_count(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"unread": inbox.unread_count(db, principal)}


@router.post("/read")
def mark_read(body: MarkRead, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"marked": inbox.mark_read(db, principal, body.ids)}
