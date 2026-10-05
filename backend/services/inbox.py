"""In-app notification center.

Who sees a notification is decided here, from the database:
  SUPER_ADMIN        platform events (cooperative_id NULL)
  cooperative user   events of their own cooperative addressed to them, or to their role
Nobody sees another cooperative's events.

`notify` only adds rows (no commit): call it inside the transaction of the event it describes.
"""
import datetime
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import and_, exists, or_
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import iso
from models.inbox import InboxNotification, InboxRead

STAFF = ("COOP_ADMIN", "MANAGER")


def notify(
    db: Session, *, cooperative_id: Optional[UUID], category: str, type: str, title: str,
    roles: Iterable[str] = (), recipient_user_id: Optional[UUID] = None, severity: str = "INFO",
    body: Optional[str] = None, entity_type: Optional[str] = None, entity_id=None, link: Optional[str] = None,
    dedupe_minutes: int = 0,
) -> Optional[InboxNotification]:
    """Add a notification. With dedupe_minutes, an identical one (same type, entity and audience) raised
    within that window is not repeated."""
    roles = tuple(roles)
    if dedupe_minutes and entity_id is not None:
        since = datetime.datetime.utcnow() - datetime.timedelta(minutes=dedupe_minutes)
        if db.query(InboxNotification.id).filter(
            InboxNotification.cooperative_id == cooperative_id if cooperative_id else InboxNotification.cooperative_id.is_(None),
            InboxNotification.type == type, InboxNotification.entity_id == str(entity_id),
            InboxNotification.created_at >= since,
        ).first():
            return None
    row = InboxNotification(
        cooperative_id=cooperative_id, recipient_user_id=recipient_user_id,
        audience_roles=",".join(roles) or None, category=category, type=type, severity=severity,
        title=title[:200], body=body, entity_type=entity_type, entity_id=str(entity_id) if entity_id is not None else None,
        link=link, created_at=datetime.datetime.utcnow(),
    )
    db.add(row)
    return row


def platform(db: Session, **kwargs) -> Optional[InboxNotification]:
    """A platform-level event for platform staff."""
    return notify(db, cooperative_id=None, roles=("SUPER_ADMIN",), **kwargs)


def visible(db: Session, principal: Principal):
    query = db.query(InboxNotification)
    me = principal.user.id
    if principal.is_superadmin:
        return query.filter(or_(InboxNotification.cooperative_id.is_(None), InboxNotification.recipient_user_id == me))
    role = principal.role
    addressed_to_role = and_(
        InboxNotification.recipient_user_id.is_(None),
        or_(
            InboxNotification.audience_roles == role,
            InboxNotification.audience_roles.like(f"{role},%"),
            InboxNotification.audience_roles.like(f"%,{role}"),
            InboxNotification.audience_roles.like(f"%,{role},%"),
        ),
    )
    return query.filter(
        InboxNotification.cooperative_id == principal.cooperative_id,
        or_(InboxNotification.recipient_user_id == me, addressed_to_role),
    )


def unread_filter(principal: Principal):
    return ~exists().where(and_(InboxRead.notification_id == InboxNotification.id, InboxRead.user_id == principal.user.id))


def item_json(n: InboxNotification, read: bool) -> dict:
    return {
        "id": str(n.id),
        "cooperative_id": str(n.cooperative_id) if n.cooperative_id else None,
        "category": n.category,
        "type": n.type,
        "severity": n.severity,
        "title": n.title,
        "body": n.body,
        "entity_type": n.entity_type,
        "entity_id": n.entity_id,
        "link": n.link,
        "read": read,
        "created_at": iso(n.created_at),
    }


def mark_read(db: Session, principal: Principal, ids: Optional[list[UUID]]) -> int:
    """Mark the given notifications (or every visible unread one) as read for the caller."""
    query = visible(db, principal).filter(unread_filter(principal))
    if ids is not None:
        query = query.filter(InboxNotification.id.in_(ids))
    rows = query.limit(1000).all()
    now = datetime.datetime.utcnow()
    for n in rows:
        db.add(InboxRead(notification_id=n.id, user_id=principal.user.id, read_at=now))
    db.commit()
    return len(rows)
