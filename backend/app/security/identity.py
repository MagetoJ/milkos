"""Maps a verified Supabase session onto the Milkos ``User``.

Roles and memberships are read from our database on every request, so a
revoked role or suspended account takes effect immediately instead of waiting
for the access token to expire.

Runs on an owner session (not a tenant transaction) because it spans every
cooperative the user belongs to.
"""

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Forbidden
from app.db.enums import MembershipStatus, UserStatus
from app.db.models import Membership, User, utcnow
from app.services.audit import record_security

from .principal import AuthPrincipal, PrincipalMembership, SupabaseClaims


class RequestInfo:
    """Client details recorded with sign-in events."""

    def __init__(self, ip: str | None = None, user_agent: str | None = None, request_id: str | None = None):
        self.ip = ip or "unknown"
        self.user_agent = user_agent
        self.request_id = request_id


async def resolve_principal(session: AsyncSession, claims: SupabaseClaims, info: RequestInfo) -> AuthPrincipal:
    user = await _load_user(session, claims.sub)
    if user is None:
        user = await _create_user(session, claims)

    if user.status == UserStatus.SUSPENDED:
        raise Forbidden("This account has been suspended", code="ACCOUNT_SUSPENDED")

    if claims.session_id and claims.session_id != user.last_session_id:
        user = await _on_new_session(session, user, claims, info)

    return _to_principal(user, claims)


async def _load_user(session: AsyncSession, auth_user_id: str) -> User | None:
    stmt = (
        select(User)
        .where(User.auth_user_id == auth_user_id)
        .options(selectinload(User.memberships).selectinload(Membership.cooperative))
        .execution_options(populate_existing=True)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _create_user(session: AsyncSession, claims: SupabaseClaims) -> User:
    """First request from a new Supabase account: create its Milkos user row."""
    try:
        async with session.begin_nested():
            session.add(
                User(
                    auth_user_id=claims.sub,
                    email=claims.email.lower() if claims.email else None,
                    phone=claims.phone,
                    display_name=display_name_from(claims),
                )
            )
    except IntegrityError:
        # Two first requests raced; the other one created the row. Fall through and load it.
        pass
    user = await _load_user(session, claims.sub)
    assert user is not None
    return user


async def _on_new_session(session: AsyncSession, user: User, claims: SupabaseClaims, info: RequestInfo) -> User:
    """First request of a new Supabase session: accept invitations, sync profile, record the sign-in."""
    now = utcnow()
    await session.execute(
        update(Membership)
        .where(Membership.user_id == user.id, Membership.status == MembershipStatus.INVITED)
        .values(status=MembershipStatus.ACTIVE, activated_at=now)
    )
    await record_security(
        session,
        event="AUTH_SIGN_IN",
        result="SUCCESS",
        user_id=user.id,
        ip_address=info.ip,
        user_agent=info.user_agent,
        request_id=info.request_id,
        metadata={"methods": sign_in_methods(claims), "aal": claims.aal, "sessionId": claims.session_id},
    )
    user.last_session_id = claims.session_id
    user.last_sign_in_at = now
    if claims.email:
        user.email = claims.email.lower()
    if claims.phone:
        user.phone = claims.phone
    await session.flush()
    reloaded = await _load_user(session, claims.sub)
    assert reloaded is not None
    return reloaded


def _to_principal(user: User, claims: SupabaseClaims) -> AuthPrincipal:
    return AuthPrincipal(
        id=user.id,
        auth_user_id=user.auth_user_id,
        email=user.email,
        phone=user.phone,
        display_name=user.display_name,
        platform_role=user.platform_role,
        default_cooperative_id=user.default_cooperative_id,
        aal="aal2" if claims.aal == "aal2" else "aal1",
        sign_in_methods=sign_in_methods(claims),
        memberships=[
            PrincipalMembership(
                id=m.id,
                cooperative_id=m.cooperative_id,
                cooperative_name=m.cooperative.name,
                cooperative_status=m.cooperative.status,
                role=m.role,
                status=m.status,
            )
            for m in user.memberships
            if m.status == MembershipStatus.ACTIVE
        ],
    )


def sign_in_methods(claims: SupabaseClaims) -> list[str]:
    return [str(m.get("method")) for m in claims.amr if isinstance(m, dict) and m.get("method")]


def display_name_from(claims: SupabaseClaims) -> str:
    meta = claims.user_metadata
    for key in ("full_name", "name"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if claims.email:
        return claims.email.split("@")[0]
    return claims.phone or "New user"