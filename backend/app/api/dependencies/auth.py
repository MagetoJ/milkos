"""Authentication and authorisation dependencies.

Every protected endpoint depends on one of:

  require_superadmin             platform staff only
  require_permission(*perms)     any role holding all of `perms` (see app.core.permissions)
  load_principal                 any signed-in account (the endpoint checks the rest)

They return an app.services.principal.Principal; its docstring has the tenant-isolation rules.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.cookies import COOKIE_NAME
from app.api.dependencies.db import get_db
from app.core.client import client_ip, user_agent
from app.core.permissions import Permission
from app.core.security import decode_access_token
from app.domain.exceptions import PermissionDenied, Unauthenticated
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.cooperative import Cooperative, CooperativeStatus
from app.infrastructure.db.models.user import User
from app.services.principal import FORBIDDEN, NOT_LINKED, SUSPENDED, Principal

# The only protected endpoints an account flagged must_change_password may call.
PASSWORD_CHANGE_ALLOWED = frozenset({"/api/v1/account/password", "/api/v1/account/me"})


def token_from_request(request: Request) -> Optional[str]:
    """The access token, if any: the session cookie first, then an `Authorization: Bearer` header."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    return token or None


def get_token_from_request(request: Request) -> str:
    token = token_from_request(request)
    if not token:
        raise Unauthenticated("Not authenticated")
    return token


def get_current_user(token: str = Depends(get_token_from_request)) -> dict:
    """The verified claims of the caller's access token."""
    payload = decode_access_token(token)
    if not payload.get("sub"):
        raise Unauthenticated("Invalid token subject")
    return payload


def load_principal(
    request: Request,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Principal:
    try:
        user = db.get(User, UUID(payload["sub"]))
    except (ValueError, KeyError):
        raise Unauthenticated("Invalid token subject")
    if not user or not user.is_active:
        raise Unauthenticated("Account not found or inactive")
    # Tokens issued before the last password change / session revocation / suspension are dead.
    if int(payload.get("sv", 0)) != int(user.session_epoch or 0):
        raise Unauthenticated("Your session has ended. Sign in again.")
    # An account that must replace its password may do nothing else until it has (enforced here, for every
    # protected endpoint, not by a frontend redirect).
    if user.must_change_password and request.url.path not in PASSWORD_CHANGE_ALLOWED:
        raise PermissionDenied("Change your password before continuing.", code="password_change_required")

    principal = Principal(user=user, cooperative=None, db=db, ip_address=client_ip(request), user_agent=user_agent(request))
    if principal.is_superadmin:
        return principal

    if not user.cooperative_id:
        raise PermissionDenied(NOT_LINKED)
    cooperative = db.get(Cooperative, user.cooperative_id)
    if not cooperative:
        raise PermissionDenied(NOT_LINKED)
    if cooperative.status != CooperativeStatus.ACTIVE:
        raise PermissionDenied(SUSPENDED)
    principal.cooperative = cooperative
    return principal


def require_permission(*required: Permission):
    """Dependency: the caller must hold every permission in `required`."""

    def dependency(principal: Principal = Depends(load_principal)) -> Principal:
        for permission in required:
            principal.require(permission)
        return principal

    return dependency


def require_roles(*roles: UserRole):
    """Dependency: the caller's role (read from the database) must be one of `roles`."""
    allowed = {role.value for role in roles}

    def dependency(principal: Principal = Depends(load_principal)) -> Principal:
        if principal.role not in allowed:
            raise PermissionDenied(FORBIDDEN)
        return principal

    return dependency


require_superadmin = require_roles(UserRole.SUPER_ADMIN)
