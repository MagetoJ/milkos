from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, page_params, paginate
from core.permissions import permissions_for
from core.utils import like, parse_uuid, phone_digits
from db import get_db
from models.admin import AuditLog
from models.cooperative import Cooperative
from models.user import User
from schemas.auth import UserRole
from schemas.platform import AccountStatusChange, UserCreate, UserStatusChange, UserUpdate
from services import accounts, audit, users

router = APIRouter(prefix="/users")

SORTS = {
    "full_name": User.full_name, "email": User.email, "role": User.role,
    "created_at": User.created_at, "last_login_at": User.last_login_at,
}


def _get(db: Session, user_id: str) -> User:
    user = db.get(User, parse_uuid(user_id, "User"))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _json(db: Session, user: User, sms=None) -> dict:
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    data = users.user_json(user, coop, db)
    if sms is not None:
        # Whether the provider accepted the activation SMS. Never "delivered" unless a delivery report said so.
        data["activation_sms"] = accounts.sms_outcome(sms)
    return data


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
    query = db.query(User, Cooperative).outerjoin(Cooperative, Cooperative.id == User.cooperative_id)
    if role:
        query = query.filter(User.role == role)
    if cooperative_id == "none":
        query = query.filter(User.cooperative_id.is_(None))
    elif cooperative_id:
        query = query.filter(User.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if is_active is not None:
        query = query.filter(User.is_active.is_(is_active))
    if account_status:
        query = query.filter(User.account_status == account_status)
    for term in (search or "").split():
        clauses = [User.full_name.ilike(like(term), escape="\\"), User.email.ilike(like(term), escape="\\")]
        digits = phone_digits(term)
        if digits:
            clauses.append(User.phone_number.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))
    query = apply_sort(query, params.sort, SORTS, [User.full_name, User.id])
    return paginate(query, params, lambda row: users.user_json(row[0], row[1], db))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    """Create an account in PENDING_ACTIVATION and text it a one-time activation link. No password is set here."""
    user, pending = users.create(db, admin, payload)
    sms = accounts.dispatch(db, pending, ip=admin.ip_address, ua=admin.user_agent)
    db.refresh(user)
    return _json(db, user, sms)


@router.get("/{user_id}")
def get_user(user_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    user = _get(db, user_id)
    history = (
        db.query(AuditLog)
        .filter(or_(
            (AuditLog.entity_type == "user") & (AuditLog.entity_id == str(user.id)),
            AuditLog.admin_id == user.id,
        ))
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        **_json(db, user),
        "permissions": sorted(p.value for p in permissions_for(user.role_value)),
        "activity": [audit.entry_json(e) for e in history],
    }


@router.put("/{user_id}")
def update_user(
    user_id: str, payload: UserUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    user, pending = users.update(db, admin, _get(db, user_id), payload)
    sms = accounts.dispatch(db, pending, ip=admin.ip_address, ua=admin.user_agent)
    return _json(db, user, sms)


@router.patch("/{user_id}/status")
def change_user_status(
    user_id: str, payload: UserStatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    user, pending = users.set_active(db, admin, _get(db, user_id), payload.is_active, payload.reason)
    return _json(db, user, accounts.dispatch(db, pending))


@router.post("/{user_id}/account-status")
def set_account_status(
    user_id: str, payload: AccountStatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    """Suspend, disable or reactivate (reactivating a never-activated account sends a new activation link)."""
    user, pending = users.change_status(db, admin, _get(db, user_id), payload.status, payload.reason)
    return _json(db, user, accounts.dispatch(db, pending))


@router.post("/{user_id}/resend-activation")
def resend_activation(user_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    user = _get(db, user_id)
    sms = accounts.dispatch(db, accounts.resend_activation(db, admin, user))
    db.refresh(user)
    return _json(db, user, sms)


@router.post("/{user_id}/revoke-invitation")
def revoke_invitation(
    user_id: str, payload: UserStatusChange | None = None, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _json(db, accounts.revoke_invitation(db, admin, _get(db, user_id), payload.reason if payload else None))


@router.post("/{user_id}/reset-password")
def reset_password(user_id: str, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    """Text the person a password reset link. The administrator never sets, sees or receives the password."""
    user = _get(db, user_id)
    sms = accounts.dispatch(db, accounts.admin_password_reset(db, admin, user))
    return {"sent": True, **accounts.sms_outcome(sms)}
