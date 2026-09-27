"""FastAPI dependencies for authentication and authorization.

Usage in a route::

    @router.get("/cooperatives/{cooperative_id}/members")
    async def list_members(access: Access = Depends(require_access("members:read"))):
        async with access.tenant_session() as db:
            ...

Order of checks, for every protected route:

1. ``get_current_user``: verify the Supabase JWT and load the Milkos principal.
2. MFA step-up: privileged roles need an ``aal2`` session.
3. Resolve which cooperative the request targets and prove the caller may act in it.
4. Check the declared permissions against the caller's roles in that cooperative.

Routes with no ``Depends(get_current_user)`` / ``require_access`` are public.
"""

import json
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import BadRequest, Forbidden, NotFound, Unauthorized
from app.db.enums import CooperativeStatus
from app.db.models import Cooperative
from app.db.session import owner_session, tenant_session
from app.services.audit import record_security

from .identity import RequestInfo, resolve_principal
from .jwt import SupabaseJwtVerifier
from .permissions import (
    MFA_MEMBERSHIP_ROLES,
    MFA_PLATFORM_ROLES,
    is_tenant_permission,
    platform_permissions,
    tenant_permissions,
)
from .principal import AuthPrincipal, RequestTenant

TENANT_HEADER = "x-cooperative-id"


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #

def get_verifier(request: Request) -> SupabaseJwtVerifier:
    return request.app.state.jwt_verifier


def request_info(request: Request) -> RequestInfo:
    return RequestInfo(
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", None),
    )


def client_ip(request: Request) -> str:
    # Run uvicorn with --proxy-headers behind a trusted proxy so this is the real client.
    return request.client.host if request.client else "unknown"


async def get_current_user(request: Request, verifier: SupabaseJwtVerifier = Depends(get_verifier)) -> AuthPrincipal:
    """Verify ``Authorization: Bearer <supabase access token>`` and return the caller."""
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached

    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Unauthorized()

    claims = await verifier.verify(token.strip())
    # Own short transaction so sign-in bookkeeping commits even if the route later fails.
    async with owner_session() as session:
        principal = await resolve_principal(session, claims, request_info(request))
    request.state.principal = principal
    return principal


# --------------------------------------------------------------------------- #
# Authorization
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Access:
    """Result of a successful authorization check, handed to the route."""

    user: AuthPrincipal
    tenant: RequestTenant | None
    permissions: frozenset[str]

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    def require_tenant(self) -> RequestTenant:
        if self.tenant is None:
            raise BadRequest("Select a cooperative using the x-cooperative-id header", code="TENANT_REQUIRED")
        return self.tenant

    def tenant_session(self) -> AbstractAsyncContextManager[AsyncSession]:
        """RLS-bound transaction for the resolved cooperative."""
        tenant = self.require_tenant()
        return tenant_session(tenant.cooperative_id, self.user.id)


def requires_mfa(user: AuthPrincipal) -> bool:
    return (user.platform_role is not None and user.platform_role in MFA_PLATFORM_ROLES) or any(
        m.role in MFA_MEMBERSHIP_ROLES for m in user.memberships
    )


CooperativeExists = Callable[[str], Awaitable[bool]]


async def cooperative_exists(cooperative_id: str) -> bool:
    async with owner_session() as session:
        count = await session.scalar(select(func.count()).select_from(Cooperative).where(Cooperative.id == cooperative_id))
        return bool(count)


def require_access(
    *permissions: str,
    platform_scope: bool = False,
    allow_aal1: bool = False,
) -> Callable[..., Awaitable[Access]]:
    """Build a dependency that authorizes the request.

    :param permissions: every one must be held. Tenant permissions also require a resolved cooperative.
    :param platform_scope: never resolve a cooperative for this route (cross-tenant platform endpoints).
    :param allow_aal1: reachable before MFA step-up (session bootstrap only; use sparingly).
    """
    from .permissions import ALL_PERMISSIONS

    unknown = set(permissions) - ALL_PERMISSIONS
    if unknown:
        raise ValueError(f"Unknown permissions: {sorted(unknown)}")
    needs_tenant = any(is_tenant_permission(p) for p in permissions)

    async def dependency(request: Request, user: AuthPrincipal = Depends(get_current_user)) -> Access:
        exists: CooperativeExists = getattr(request.app.state, "cooperative_exists", cooperative_exists)
        settings = get_settings()

        if settings.require_mfa and user.aal != "aal2" and requires_mfa(user) and not allow_aal1:
            raise Forbidden("Verify with your authenticator app to continue", code="MFA_REQUIRED")

        tenant: RequestTenant | None = None
        if not platform_scope:
            requested = await _requested_cooperative(request)
            tenant = await resolve_tenant(request, user, requested, needs_tenant, exists)
        if needs_tenant and tenant is None:
            raise BadRequest("Select a cooperative using the x-cooperative-id header", code="TENANT_REQUIRED")

        granted = set(platform_permissions(user.platform_role))
        if tenant is not None:
            granted.update(tenant_permissions(user.platform_role, tenant.roles))

        missing = [p for p in permissions if p not in granted]
        if missing:
            await _security_event(
                request, user, "AUTHORIZATION_DENIED", "DENIED", reason=f"missing:{','.join(missing)}",
                cooperative_id=tenant.cooperative_id if tenant else None,
            )
            raise Forbidden("You do not have permission to perform this action", code="PERMISSION_DENIED")

        return Access(user=user, tenant=tenant, permissions=frozenset(granted))

    return dependency


async def _requested_cooperative(request: Request) -> tuple[list[str], str | None]:
    """Explicit identifiers (path, body, query) and the ambient header, as sent by the client."""
    explicit: list[str] = []
    if value := request.path_params.get("cooperative_id"):
        explicit.append(str(value))
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()  # Starlette caches the body; the route can still read it.
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = None
        if isinstance(body, dict) and isinstance(body.get("cooperativeId"), str):
            explicit.append(body["cooperativeId"])
    if value := request.query_params.get("cooperativeId"):
        explicit.append(value)
    return explicit, request.headers.get(TENANT_HEADER)


async def resolve_tenant(
    request: Request,
    user: AuthPrincipal,
    requested: tuple[list[str], str | None],
    needs_tenant: bool,
    exists: CooperativeExists,
) -> RequestTenant | None:
    explicit, header = requested
    # Route/body/query identifiers win over the ambient header, but must agree with each other.
    if len(set(explicit)) > 1:
        raise BadRequest("Conflicting cooperative identifiers in request")
    cooperative_id = explicit[0] if explicit else header

    if not cooperative_id:
        if not needs_tenant:
            return None
        member_of = {m.cooperative_id for m in user.memberships}
        if len(member_of) == 1:
            cooperative_id = next(iter(member_of))
        elif user.default_cooperative_id in member_of:
            cooperative_id = user.default_cooperative_id
        else:
            return None

    memberships = [m for m in user.memberships if m.cooperative_id == cooperative_id]
    roles = list(dict.fromkeys(m.role for m in memberships))

    if user.platform_role is not None:
        if not await exists(cooperative_id):
            raise NotFound("Cooperative not found")
        via_platform_role = not roles
        if via_platform_role and request.method != "GET":
            await _security_event(
                request, user, "PLATFORM_TENANT_ACCESS", "SUCCESS", cooperative_id=cooperative_id,
                metadata={"method": request.method, "platformRole": user.platform_role.value},
            )
        return RequestTenant(cooperative_id=cooperative_id, roles=roles, via_platform_role=via_platform_role)

    if not memberships:
        await _security_event(
            request, user, "TENANT_ACCESS_DENIED", "DENIED", reason="NO_MEMBERSHIP",
            metadata={"cooperativeId": cooperative_id},
        )
        raise Forbidden("You do not have access to this cooperative", code="TENANT_FORBIDDEN")
    if memberships[0].cooperative_status != CooperativeStatus.APPROVED:
        raise Forbidden("This cooperative is not active", code="TENANT_INACTIVE")
    return RequestTenant(cooperative_id=cooperative_id, roles=roles, via_platform_role=False)


async def _security_event(request: Request, user: AuthPrincipal, event: str, result: str, **fields) -> None:
    recorder = getattr(request.app.state, "security_recorder", None)
    info = request_info(request)
    payload = dict(event=event, result=result, user_id=user.id, ip_address=info.ip,
                   user_agent=info.user_agent, request_id=info.request_id, **fields)
    if recorder is not None:  # Tests substitute an in-memory recorder.
        await recorder(payload)
        return
    async with owner_session() as session:
        await record_security(session, **payload)