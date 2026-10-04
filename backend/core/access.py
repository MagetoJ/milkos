"""Who is calling, what they may do, and which cooperative's data they may touch.

Every protected endpoint depends on one of:

  require_superadmin             platform staff only
  require_permission(*perms)     any role holding all of `perms` (see core.permissions)

Both return a `Principal` built from the DATABASE, not from the token's claims, so a deactivated
account, a changed role or a suspended cooperative takes effect on the very next request.

Tenant isolation rules (enforced here, never by the frontend):
  SUPER_ADMIN   every cooperative; may name one with ?cooperative_id=
  COOP_ADMIN,   only users.cooperative_id. A different cooperative_id in a request is refused (403);
  MANAGER       rows of other cooperatives look missing (404).
  COLLECTOR     their cooperative, and only collections they recorded / were assigned
  FARMER        only their own farmer record and its collections
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from core.permissions import Permission, permissions_for
from db import get_db
from models.cooperative import Cooperative, CooperativeStatus
from models.farmer import Farmer
from models.operations import Collector
from models.user import User
from routers.auth import get_current_user
from schemas.auth import UserRole

FORBIDDEN = "Insufficient permissions for this action"
NOT_LINKED = "Your account is not linked to a cooperative."
SUSPENDED = "This cooperative is suspended. Contact the platform administrator."


@dataclass
class Principal:
    user: User
    cooperative: Optional[Cooperative]
    db: Session
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    # The registered device a sync request came from (set by routers/sync.py); noted in audit entries.
    device: Optional[object] = None
    _collector: Optional[Collector] = field(default=None, repr=False)
    _farmer: Optional[Farmer] = field(default=None, repr=False)

    @property
    def role(self) -> str:
        return self.user.role_value

    @property
    def is_superadmin(self) -> bool:
        return self.role == UserRole.SUPER_ADMIN.value

    @property
    def permissions(self) -> frozenset[Permission]:
        return permissions_for(self.role)

    def can(self, permission: Permission) -> bool:
        return permission in self.permissions

    def require(self, permission: Permission) -> None:
        if not self.can(permission):
            raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)

    @property
    def cooperative_id(self) -> Optional[UUID]:
        return self.cooperative.id if self.cooperative else None

    def collector_profile(self) -> Collector:
        """The caller's collector profile (COLLECTOR role only)."""
        if self._collector is None:
            profile = self.db.query(Collector).filter(Collector.user_id == self.user.id).first()
            if profile is None or profile.cooperative_id != self.cooperative_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Your collector profile has not been set up. Ask your cooperative admin.")
            if profile.status != "ACTIVE":
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Your collector profile is inactive. Ask your cooperative admin.")
            self._collector = profile
        return self._collector

    def farmer_profile(self) -> Farmer:
        """The farmer record linked to the caller's account (FARMER role only)."""
        if self._farmer is None:
            farmer = self.db.query(Farmer).filter(Farmer.user_id == self.user.id).first()
            if farmer is None or farmer.cooperative_id != self.cooperative_id:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is not linked to a farmer record.")
            self._farmer = farmer
        return self._farmer


def _client_ip(request: Request) -> Optional[str]:
    # Behind the Next.js proxy the browser's address arrives in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host[:64] if request.client else None


def load_principal(
    request: Request,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Principal:
    try:
        user = db.get(User, UUID(payload["sub"]))
    except (ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token subject")
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or inactive")

    principal = Principal(
        user=user, cooperative=None, db=db,
        ip_address=_client_ip(request), user_agent=(request.headers.get("user-agent") or "")[:500] or None,
    )
    if principal.is_superadmin:
        return principal

    if not user.cooperative_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_LINKED)
    cooperative = db.get(Cooperative, user.cooperative_id)
    if not cooperative:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_LINKED)
    if cooperative.status != CooperativeStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, SUSPENDED)
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
            raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)
        return principal

    return dependency


require_superadmin = require_roles(UserRole.SUPER_ADMIN)


def get_current_cooperative(principal: Principal = Depends(load_principal)) -> Cooperative:
    """The caller's own (active) cooperative. Platform accounts have none."""
    if principal.cooperative is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_LINKED)
    return principal.cooperative


def verify_cooperative_access(principal: Principal, cooperative_id: Optional[UUID]) -> None:
    """Refuse (403) a request that names a cooperative the caller does not belong to."""
    if principal.is_superadmin or cooperative_id is None:
        return
    if cooperative_id != principal.cooperative_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only access your own cooperative.")


def cooperative_scope(principal: Principal, requested: Optional[UUID] = None) -> Optional[UUID]:
    """The cooperative a query must be limited to (None = all, superadmin only).

    A non-superadmin naming another cooperative is refused; one naming nothing gets their own.
    """
    verify_cooperative_access(principal, requested)
    return requested if principal.is_superadmin else principal.cooperative_id


def ensure_same_cooperative(principal: Principal, row, what: str):
    """404 when `row` is missing or belongs to another cooperative (indistinguishable on purpose)."""
    if row is None or (not principal.is_superadmin and getattr(row, "cooperative_id", None) != principal.cooperative_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return row
