from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.domain.schemas.auth import UserRole
from app.domain.schemas.platform import AccountStatusChange, UserCreate, UserStatusChange, UserUpdate
from app.infrastructure.db.pagination import PageParams
from app.services import accounts, users
from app.services.platform_admin import people
from app.services.principal import Principal

router = APIRouter(prefix="/users")


@router.get("")
def list_users(
    search: Optional[str] = Query(None, max_length=100),
    role: Optional[UserRole] = None,
    cooperative_id: Optional[str] = Query(None, description="A cooperative id, or 'none' for platform accounts"),
    is_active: Optional[bool] = None,
    account_status: Optional[str] = Query(None, max_length=30),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return people.users_page(
        db, search=search, role=role, cooperative_id=cooperative_id, is_active=is_active,
        account_status=account_status, params=params,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    """Create an account in PENDING_ACTIVATION and text it a one-time activation link. No password is set here."""
    return people.create_user(db, admin, payload)


@router.get("/{user_id}")
def get_user(user_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return people.user_detail(db, people.get_user(db, user_id))


@router.put("/{user_id}")
def update_user(
    user_id: str, payload: UserUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    user, pending = users.update(db, admin, people.get_user(db, user_id), payload)
    sms = accounts.dispatch(db, pending, ip=admin.ip_address, ua=admin.user_agent)
    return people.user_json(db, user, sms)


@router.patch("/{user_id}/status")
def change_user_status(
    user_id: str, payload: UserStatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    user, pending = users.set_active(db, admin, people.get_user(db, user_id), payload.is_active, payload.reason)
    return people.user_json(db, user, accounts.dispatch(db, pending))


@router.post("/{user_id}/account-status")
def set_account_status(
    user_id: str, payload: AccountStatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    """Suspend, disable or reactivate (reactivating a never-activated account sends a new activation link)."""
    user, pending = users.change_status(db, admin, people.get_user(db, user_id), payload.status, payload.reason)
    return people.user_json(db, user, accounts.dispatch(db, pending))


@router.post("/{user_id}/resend-activation")
def resend_activation(user_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return people.resend_activation(db, admin, people.get_user(db, user_id))


@router.post("/{user_id}/revoke-invitation")
def revoke_invitation(
    user_id: str, payload: UserStatusChange | None = None, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    user = accounts.revoke_invitation(db, admin, people.get_user(db, user_id), payload.reason if payload else None)
    return people.user_json(db, user)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    """Text the person a password reset link. The administrator never sets, sees or receives the password."""
    sms = accounts.dispatch(db, accounts.admin_password_reset(db, admin, people.get_user(db, user_id)))
    return {"sent": True, **accounts.sms_outcome(sms)}
