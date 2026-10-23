"""Work done after the response: SMS delivery and alert housekeeping.

Callers hand these to a TaskDispatcher (app.domain.interfaces) instead of doing them inline, so a slow or
unreachable SMS provider never holds up the request that created the message. Delivery state lives in the
notifications table, so a task that never runs leaves its messages PENDING for the next dispatch_due.
"""
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.domain.interfaces import TaskDispatcher
from app.infrastructure.db.models.sync import Device
from app.infrastructure.db.models.user import User
from app.infrastructure.tasks import task
from app.services import cooler_alerts, notifications
from app.services.principal import Principal

DELIVER = "notifications.deliver"
HOUSEKEEPING = "notifications.housekeeping"


@dataclass
class TaskActor:
    """Who caused the work, rebuilt in the task's own session; enough for audit.record."""
    user: User
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device: Optional[Device] = None


def _actor_ref(actor: Optional[Principal]) -> Optional[dict]:
    """The caller as plain values (a task may run in another process, so no ORM objects)."""
    if actor is None:
        return None
    return {
        "user_id": str(actor.user.id),
        "ip_address": actor.ip_address,
        "user_agent": actor.user_agent,
        "device_id": str(actor.device.id) if actor.device is not None else None,
    }


def _load_actor(db: Session, ref: Optional[Mapping[str, Any]]) -> Optional[TaskActor]:
    if not ref:
        return None
    user = db.get(User, UUID(ref["user_id"]))
    if user is None:
        return None
    device = db.get(Device, UUID(ref["device_id"])) if ref.get("device_id") else None
    return TaskActor(user=user, ip_address=ref.get("ip_address"), user_agent=ref.get("user_agent"), device=device)


def deliver_later(tasks: TaskDispatcher, notification_ids: Iterable[UUID], actor: Optional[Principal] = None,
                  retry_due_for: Optional[UUID] = None) -> None:
    """Send these SMS after the response. With `retry_due_for`, also retry that cooperative's SMS whose retry time
    has come."""
    ids = [str(i) for i in notification_ids]
    if ids or retry_due_for:
        tasks.enqueue(DELIVER, {
            "notification_ids": ids,
            "retry_due_for": str(retry_due_for) if retry_due_for else None,
            "actor": _actor_ref(actor),
        })


def housekeeping_later(tasks: TaskDispatcher, cooperative_id: Optional[UUID], actor: Optional[Principal] = None) -> None:
    """Raise stale-reading alerts and retry due SMS for one cooperative."""
    if cooperative_id is not None:
        tasks.enqueue(HOUSEKEEPING, {"cooperative_id": str(cooperative_id), "actor": _actor_ref(actor)})


@task(DELIVER)
def _deliver(db: Session, payload: Mapping[str, Any]) -> None:
    actor = _load_actor(db, payload.get("actor"))
    notifications.dispatch(db, [UUID(i) for i in payload["notification_ids"]], actor)
    if payload.get("retry_due_for"):
        notifications.dispatch_due(db, UUID(payload["retry_due_for"]), actor)


@task(HOUSEKEEPING)
def _housekeeping(db: Session, payload: Mapping[str, Any]) -> None:
    cooperative_id = UUID(payload["cooperative_id"])
    actor = _load_actor(db, payload.get("actor"))
    created = cooler_alerts.evaluate_staleness(db, cooperative_id)
    db.commit()
    notifications.dispatch(db, [n.id for n in created], actor)
    notifications.dispatch_due(db, cooperative_id, actor)
