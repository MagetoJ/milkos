from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import RequestContext
from app.models.audit import AuditEvent
from app.models.security_event import SecurityEvent


def record_audit(
    db: AsyncSession,
    ctx: RequestContext,
    *,
    action: str,
    result: str,
    actor_user_id: UUID | None = None,
    cooperative_id: UUID | None = None,
    entity_type: str | None = None,
    entity_id: UUID | str | None = None,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Stage an append-only audit row in the caller's transaction."""
    db.add(
        AuditEvent(
            cooperative_id=cooperative_id,
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            result=result,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            request_id=ctx.request_id,
            before_state=before_state,
            after_state=after_state,
            metadata_=metadata,
        )
    )


def record_security_event(
    db: AsyncSession,
    ctx: RequestContext,
    *,
    event: str,
    result: str,
    user_id: UUID | None = None,
    cooperative_id: UUID | None = None,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Stage a security event row. Never put OTPs or tokens in `metadata`."""
    db.add(
        SecurityEvent(
            user_id=user_id,
            cooperative_id=cooperative_id,
            event=event,
            result=result,
            reason=reason,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            request_id=ctx.request_id,
            metadata_=metadata,
        )
    )
