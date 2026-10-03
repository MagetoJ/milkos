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
from schemas.platform import PasswordReset, UserCreate, UserStatusChange, UserUpdate
from services import audit, users

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


def _json(db: Session, user: User) -> dict:
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    return users.user_json(user, coop)


@router.get("")
def list_users(
    search: Optional[str] = Query(None, max_length=100),
    role: Optional[UserRole] = None,
    cooperative_id: Optional[str] = Query(None, description="A cooperative id, or 'none' for platform accounts"),
    is_active: Optional[bool] = None,
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
    for term in (search or "").split():
        clauses = [User.full_name.ilike(like(term), escape="\\"), User.email.ilike(like(term), escape="\\")]
        digits = phone_digits(term)
        if digits:
            clauses.append(User.phone_number.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))
    query = apply_sort(query, params.sort, SORTS, [User.full_name, User.id])
    return paginate(query, params, lambda row: users.user_json(row[0], row[1]))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return _json(db, users.create(db, admin, payload))


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
    return _json(db, users.update(db, admin, _get(db, user_id), payload))


@router.patch("/{user_id}/status")
def change_user_status(
    user_id: str, payload: UserStatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _json(db, users.set_active(db, admin, _get(db, user_id), payload.is_active, payload.reason))


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: str, payload: PasswordReset, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    users.reset_password(db, admin, _get(db, user_id), payload.password)
