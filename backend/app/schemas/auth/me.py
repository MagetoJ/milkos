from uuid import UUID

from pydantic import BaseModel

from app.models.membership import MembershipRole


class MembershipSummary(BaseModel):
    cooperative_id: UUID
    cooperative_name: str
    role: MembershipRole


class CurrentUserResponse(BaseModel):
    id: UUID
    keycloak_id: str
    email: str | None
    phone: str | None
    display_name: str
    platform_roles: list[str] = []
    # Only active memberships in approved cooperatives, i.e. the tenants this
    # user can currently act in.
    memberships: list[MembershipSummary] = []
