"""In-app notification center: /api/v1/inbox. What a caller sees is decided by services/inbox.visible."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

from core.access import Principal, load_principal
from core.pagination import PageParams, fetch_page, page_params, page_result
from db import get_db
from models.inbox import InboxNotification, InboxRead
from services import inbox

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
    query = inbox.visible(db, principal)
    if unread_only:
        query = query.filter(inbox.unread_filter(principal))
    if category:
        query = query.filter(InboxNotification.category == category)
    rows, total = fetch_page(query.order_by(InboxNotification.created_at.desc(), InboxNotification.id), params)
    read = {
        r[0] for r in db.query(InboxRead.notification_id).filter(
            and_(InboxRead.user_id == principal.user.id, InboxRead.notification_id.in_([n.id for n in rows]))
        )
    } if rows else set()
    result = page_result([inbox.item_json(n, n.id in read) for n in rows], total, params)
    result["unread"] = inbox.visible(db, principal).filter(inbox.unread_filter(principal)).count()
    return result


@router.get("/count")
def unread_count(principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"unread": inbox.visible(db, principal).filter(inbox.unread_filter(principal)).count()}


@router.post("/read")
def mark_read(body: MarkRead, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    return {"marked": inbox.mark_read(db, principal, body.ids)}
