"""Who is calling, what they may do, and which cooperative's data they may touch.

A Principal is built by app.api.dependencies.auth from the DATABASE, not from the token's claims, so a
deactivated account, a changed role or a suspended cooperative takes effect on the very next request.

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

from sqlalchemy.orm import Session

from app.core.permissions import Permission, permissions_for
from app.core.utils import parse_uuid
from app.domain.exceptions import NotFound, PermissionDenied
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.operations import Collector
from app.infrastructure.db.models.user import User

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
    # The registered device a sync request came from (set by the sync router); noted in audit entries.
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
            raise PermissionDenied(FORBIDDEN)

    def require_tenant(self, message: str = FORBIDDEN) -> "Principal":
        """Refuse platform staff: the endpoint works on the caller's own cooperative. (Every other signed-in
        account has one; load_principal refuses accounts without.)"""
        if self.cooperative is None:
            raise PermissionDenied(message)
        return self

    @property
    def cooperative_id(self) -> Optional[UUID]:
        return self.cooperative.id if self.cooperative else None

    def collector_profile(self) -> Collector:
        """The caller's collector profile (COLLECTOR role only)."""
        if self._collector is None:
            profile = self.db.query(Collector).filter(Collector.user_id == self.user.id).first()
            if profile is None or profile.cooperative_id != self.cooperative_id:
                raise PermissionDenied("Your collector profile has not been set up. Ask your cooperative admin.")
            if profile.status != "ACTIVE":
                raise PermissionDenied("Your collector profile is inactive. Ask your cooperative admin.")
            self._collector = profile
        return self._collector

    def farmer_profile(self) -> Farmer:
        """The farmer record linked to the caller's account (FARMER role only)."""
        if self._farmer is None:
            farmer = self.db.query(Farmer).filter(Farmer.user_id == self.user.id).first()
            if farmer is None or farmer.cooperative_id != self.cooperative_id:
                raise PermissionDenied("Your account is not linked to a farmer record.")
            self._farmer = farmer
        return self._farmer


def verify_cooperative_access(principal: Principal, cooperative_id: Optional[UUID]) -> None:
    """Refuse (403) a request that names a cooperative the caller does not belong to."""
    if principal.is_superadmin or cooperative_id is None:
        return
    if cooperative_id != principal.cooperative_id:
        raise PermissionDenied("You can only access your own cooperative.")


def cooperative_scope(principal: Principal, requested: Optional[UUID] = None) -> Optional[UUID]:
    """The cooperative a query must be limited to (None = all, superadmin only).

    A non-superadmin naming another cooperative is refused; one naming nothing gets their own.
    """
    verify_cooperative_access(principal, requested)
    return requested if principal.is_superadmin else principal.cooperative_id


def get_or_404(db: Session, model, raw_id, what: str, cooperative_id: Optional[UUID] = None):
    """The `model` row with id `raw_id`, limited to `cooperative_id` when given. Anything else, including a
    malformed id or another cooperative's row, is 404 "<what> not found"."""
    row = db.get(model, parse_uuid(raw_id, what))
    if row is None or (cooperative_id is not None and getattr(row, "cooperative_id", None) != cooperative_id):
        raise NotFound(what)
    return row


def own(db: Session, principal: Principal, model, raw_id, what: str):
    """get_or_404 within the caller's cooperative (platform staff: any cooperative)."""
    return get_or_404(db, model, raw_id, what, None if principal.is_superadmin else principal.cooperative_id)
