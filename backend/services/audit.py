"""Audit trail. Call `record` inside the same transaction as the change, before commit,
so a change and its audit entry are saved together or not at all."""
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from core.utils import iso
from models.admin import AuditLog

# Never written to old/new values, whatever the caller passes.
_SECRET_FIELDS = {"password", "password_hash", "mpesa_reference"}


def _clean(values: Optional[dict]) -> Optional[dict]:
    if values is None:
        return None
    return {k: ("[redacted]" if k in _SECRET_FIELDS else v) for k, v in values.items()}


def record(
    db: Session,
    actor: Any,
    action: str,
    *,
    target: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[Any] = None,
    cooperative_id: Optional[UUID] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    reason: Optional[str] = None,
) -> AuditLog:
    """`actor` is a core.access.Principal (or anything with .user, .ip_address, .user_agent)."""
    user = actor.user
    summary = f"{target} (reason: {reason})" if reason else target
    device = getattr(actor, "device", None)
    if device is not None:
        # Changes that arrived through offline sync say which device captured them.
        new_values = {**(new_values or {}), "synced_from_device": device.device_identifier}
    entry = AuditLog(
        admin_id=user.id,
        actor_email=user.email,
        actor_role=user.role_value,
        action=action,
        target=summary[:500],
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        cooperative_id=cooperative_id,
        old_values=_clean(old_values),
        new_values=_clean({**(new_values or {}), **({"reason": reason} if reason else {})}) or None,
        ip_address=getattr(actor, "ip_address", None),
        user_agent=getattr(actor, "user_agent", None),
    )
    db.add(entry)
    return entry


def entry_json(entry: AuditLog, cooperative_name: Optional[str] = None) -> dict:
    return {
        "id": str(entry.id),
        "actor_id": str(entry.admin_id) if entry.admin_id else None,
        "actor_email": entry.actor_email,
        "actor_role": entry.actor_role,
        "action": entry.action,
        "target": entry.target,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "cooperative_id": str(entry.cooperative_id) if entry.cooperative_id else None,
        "cooperative_name": cooperative_name,
        "old_values": entry.old_values,
        "new_values": entry.new_values,
        "ip_address": entry.ip_address,
        "user_agent": entry.user_agent,
        "created_at": iso(entry.created_at),
        "admin_email": entry.actor_email,  # field name used by the original activity feed
    }
