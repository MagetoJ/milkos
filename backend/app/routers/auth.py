"""Session bootstrap for the web app: who am I, where can I act, and what may I do there."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select, update

from app.auth.dependencies import Access, requires_mfa, require_access
from app.auth.permissions import platform_permissions, tenant_permissions
from app.auth.schemas import (
    MeCooperative,
    MeResponse,
    MeSession,
    MeUser,
    SetDefaultCooperativeRequest,
    SetDefaultCooperativeResponse,
)
from app.core.config import get_settings
from app.core.errors import Forbidden, NotFound
from app.db.models import Cooperative, User
from app.db.session import owner_session

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MeResponse)
async def me(access: Access = Depends(require_access(platform_scope=True, allow_aal1=True))) -> MeResponse:
    """Reachable before MFA step-up so the client can learn that step-up is required."""
    user = access.user
    by_cooperative: dict[str, MeCooperative] = {}
    for m in user.memberships:
        entry = by_cooperative.get(m.cooperative_id)
        if entry is None:
            entry = MeCooperative(id=m.cooperative_id, name=m.cooperative_name, status=m.cooperative_status, roles=[], permissions=[])
            by_cooperative[m.cooperative_id] = entry
        entry.roles.append(m.role)
    for entry in by_cooperative.values():
        entry.permissions = tenant_permissions(user.platform_role, entry.roles)

    mfa_required = get_settings().require_mfa and requires_mfa(user)
    return MeResponse(
        user=MeUser(
            id=user.id, email=user.email, phone=user.phone, display_name=user.display_name,
            platform_role=user.platform_role, default_cooperative_id=user.default_cooperative_id,
        ),
        session=MeSession(
            aal=user.aal, sign_in_methods=user.sign_in_methods,
            mfa_required=mfa_required, mfa_satisfied=not mfa_required or user.aal == "aal2",
        ),
        platform_permissions=platform_permissions(user.platform_role),
        platform_tenant_permissions=tenant_permissions(user.platform_role, []) if user.platform_role else [],
        cooperatives=list(by_cooperative.values()),
    )


@router.put("/me/default-cooperative", response_model=SetDefaultCooperativeResponse)
async def set_default_cooperative(
    body: SetDefaultCooperativeRequest,
    access: Access = Depends(require_access(platform_scope=True)),
) -> SetDefaultCooperativeResponse:
    user = access.user
    cooperative_id = str(body.cooperative_id)
    is_member = any(m.cooperative_id == cooperative_id for m in user.memberships)
    async with owner_session() as db:
        if not is_member:
            if user.platform_role is None:
                raise Forbidden("You do not have access to this cooperative")
            count = await db.scalar(select(func.count()).select_from(Cooperative).where(Cooperative.id == cooperative_id))
            if not count:
                raise NotFound("Cooperative not found")
        await db.execute(update(User).where(User.id == user.id).values(default_cooperative_id=cooperative_id))
    return SetDefaultCooperativeResponse(default_cooperative_id=cooperative_id)