from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import RequestContext
from app.models.user import User
from app.services.audit import record_security_event


def _display_name(claims: dict[str, Any]) -> str:
    for claim in ("name", "preferred_username", "email"):
        value = claims.get(claim)
        if isinstance(value, str) and value.strip():
            return value.strip()[:200]
    return "Milkos user"


def _verified_email(claims: dict[str, Any]) -> str | None:
    # Only trust an email Keycloak (or the Google broker) has verified.
    email = claims.get("email")
    if claims.get("email_verified") is True and isinstance(email, str) and email:
        return email.strip().lower()
    return None


async def provision_user(
    db: AsyncSession, claims: dict[str, Any], ctx: RequestContext
) -> User:
    """Return the Milkos user for a verified token, creating it on first use.

    Race-safe: concurrent first requests for the same `sub` insert at most one
    row thanks to ON CONFLICT on the unique keycloak_id. Provisioning grants no
    tenant access; memberships are only created through reviewed flows.
    """
    keycloak_id = claims["sub"]

    inserted = await db.execute(
        insert(User)
        .values(
            keycloak_id=keycloak_id,
            email=_verified_email(claims),
            display_name=_display_name(claims),
        )
        .on_conflict_do_nothing(index_elements=[User.keycloak_id])
        .returning(User.id)
    )
    new_user_id = inserted.scalar_one_or_none()

    if new_user_id is not None:
        record_security_event(
            db,
            ctx,
            event="USER_PROVISIONED",
            result="SUCCESS",
            user_id=new_user_id,
            metadata={"identity_provider": claims.get("identity_provider")},
        )
        await db.commit()

    result = await db.execute(select(User).where(User.keycloak_id == keycloak_id))
    return result.scalar_one()
