from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.cooperative import Cooperative, CooperativeStatus
from app.models.membership import Membership, MembershipStatus
from app.schemas.auth.me import CurrentUserResponse, MembershipSummary
from app.security.authorization import (
    AuthenticatedIdentity,
    get_current_identity,
    get_or_provision_identity,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


async def _build_profile(db: AsyncSession, identity: AuthenticatedIdentity) -> CurrentUserResponse:
    rows = await db.execute(
        select(Membership.cooperative_id, Cooperative.name, Membership.role)
        .join(Cooperative, Cooperative.id == Membership.cooperative_id)
        .where(
            Membership.user_id == identity.user.id,
            Membership.status == MembershipStatus.ACTIVE,
            Cooperative.status == CooperativeStatus.APPROVED,
        )
        .order_by(Cooperative.name)
    )
    admin_role = get_settings().platform_admin_role

    user = identity.user
    # Built field by field: validating from the ORM object would touch the
    # lazy `User.memberships` relationship, which async sessions cannot load.
    return CurrentUserResponse(
        id=user.id,
        keycloak_id=user.keycloak_id,
        email=user.email,
        phone=user.phone,
        display_name=user.display_name,
        platform_roles=sorted(identity.realm_roles & {admin_role}),
        memberships=[
            MembershipSummary(cooperative_id=coop_id, cooperative_name=name, role=role)
            for coop_id, name, role in rows
        ],
    )


@router.post("/register", response_model=CurrentUserResponse)
async def register(
    identity: AuthenticatedIdentity = Depends(get_or_provision_identity),
    db: AsyncSession = Depends(get_db),
) -> CurrentUserResponse:
    """Idempotently create the Milkos user for the signed-in Keycloak account.

    Call once after the OIDC login. Grants no cooperative access by itself.
    """
    return await _build_profile(db, identity)


@router.get("/me", response_model=CurrentUserResponse)
async def get_me(
    identity: AuthenticatedIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> CurrentUserResponse:
    return await _build_profile(db, identity)
