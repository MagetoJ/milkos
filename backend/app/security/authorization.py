from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.request_context import get_request_context
from app.db.session import get_db
from app.models.cooperative import Cooperative, CooperativeStatus
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.security.keycloak import keycloak_verifier
from app.services.auth.provisioning import provision_user

bearer_scheme = HTTPBearer(auto_error=False)


def _realm_roles(claims: dict) -> frozenset[str]:
    realm_access = claims.get("realm_access")
    roles = realm_access.get("roles") if isinstance(realm_access, dict) else None
    if not isinstance(roles, list):
        return frozenset()
    return frozenset(role for role in roles if isinstance(role, str))


@dataclass(frozen=True)
class TokenIdentity:
    """A verified Keycloak token that may not have a Milkos user yet."""

    keycloak_id: str
    claims: dict

    @property
    def realm_roles(self) -> frozenset[str]:
        return _realm_roles(self.claims)


@dataclass(frozen=True)
class AuthenticatedIdentity:
    keycloak_id: str
    claims: dict
    user: User

    @property
    def realm_roles(self) -> frozenset[str]:
        return _realm_roles(self.claims)


@dataclass(frozen=True)
class TenantContext:
    """An identity authorized for exactly one cooperative (tenant)."""

    identity: AuthenticatedIdentity
    cooperative_id: UUID
    roles: frozenset[MembershipRole]


async def get_token_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> TokenIdentity:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = await keycloak_verifier.verify(credentials.credentials)
    return TokenIdentity(keycloak_id=claims["sub"], claims=claims)


async def get_current_identity(
    token: TokenIdentity = Depends(get_token_identity),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedIdentity:
    """Require a verified token *and* an existing Milkos user."""
    result = await db.execute(select(User).where(User.keycloak_id == token.keycloak_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not registered in Milkos",
        )

    return AuthenticatedIdentity(keycloak_id=token.keycloak_id, claims=token.claims, user=user)


async def get_or_provision_identity(
    request: Request,
    token: TokenIdentity = Depends(get_token_identity),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedIdentity:
    """Like get_current_identity, but creates the Milkos user on first use.

    Only for onboarding endpoints: a fresh user has no memberships and
    therefore no access to any cooperative's data.
    """
    user = await provision_user(db, token.claims, get_request_context(request))
    return AuthenticatedIdentity(keycloak_id=token.keycloak_id, claims=token.claims, user=user)


def require_platform_role(*roles: str):
    """Require a platform-level realm role (defaults to the super-admin role)."""
    allowed = set(roles) or {get_settings().platform_admin_role}

    async def dependency(
        identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    ) -> AuthenticatedIdentity:
        if not identity.realm_roles & allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return identity

    return dependency


def _active_membership_query(user_id: UUID):
    # A membership only grants access while both it and its cooperative are
    # active; a pending, rejected or suspended cooperative grants nothing.
    return (
        select(Membership)
        .join(Cooperative, Cooperative.id == Membership.cooperative_id)
        .where(
            Membership.user_id == user_id,
            Membership.status == MembershipStatus.ACTIVE,
            Cooperative.status == CooperativeStatus.APPROVED,
        )
    )


def require_role(*roles: MembershipRole):
    """Require the role in *any* cooperative.

    This is not tenant-scoped. Endpoints that read or write a cooperative's
    data must use require_cooperative_membership instead.
    """
    allowed = set(roles)

    async def dependency(
        identity: AuthenticatedIdentity = Depends(get_current_identity),
        db: AsyncSession = Depends(get_db),
    ) -> AuthenticatedIdentity:
        result = await db.execute(
            _active_membership_query(identity.user.id).where(Membership.role.in_(allowed))
        )
        if result.first() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return identity

    return dependency


def require_cooperative_membership(*roles: MembershipRole):
    """Authorize access to the `cooperative_id` path parameter.

    The cooperative ID from the client is only a *request*; access is granted
    solely from the caller's own active membership. Non-members get 404 so
    tenant IDs cannot be probed. On success the tenant is also pinned for the
    current transaction via `app.current_cooperative`, for PostgreSQL RLS
    policies on tenant-owned tables.
    """
    allowed = set(roles)

    async def dependency(
        cooperative_id: UUID,
        identity: AuthenticatedIdentity = Depends(get_current_identity),
        db: AsyncSession = Depends(get_db),
    ) -> TenantContext:
        query = _active_membership_query(identity.user.id).where(
            Membership.cooperative_id == cooperative_id
        )
        if allowed:
            query = query.where(Membership.role.in_(allowed))

        memberships = (await db.execute(query)).scalars().all()
        if not memberships:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cooperative not found",
            )

        await db.execute(
            text("SELECT set_config('app.current_cooperative', :cooperative_id, true)"),
            {"cooperative_id": str(cooperative_id)},
        )

        return TenantContext(
            identity=identity,
            cooperative_id=cooperative_id,
            roles=frozenset(membership.role for membership in memberships),
        )

    return dependency
