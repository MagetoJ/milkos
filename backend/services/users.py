"""User accounts managed by the superadmin.

Rules (enforced here, not in the UI):
- SUPER_ADMIN accounts have no cooperative; every other role must belong to one.
- Nobody can change a role to or from SUPER_ADMIN or FARMER after creation: platform access and
  farmer-record links are created deliberately, never by editing an existing account.
- COLLECTOR and FARMER accounts can't move to another cooperative (their records stay with the old one).
- A superadmin can't deactivate or re-role themselves, and the last active superadmin can't be disabled.
"""
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.security import hash_password
from core.utils import changed, conflict, field_error, iso, reject_nulls, snapshot
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector
from models.user import User
from schemas.auth import UserRole
from schemas.platform import UserCreate, UserUpdate
from services import audit, collectors

AUDITED = ("full_name", "email", "phone_number", "role", "cooperative_id", "is_active")
FIXED_ROLES = {UserRole.SUPER_ADMIN.value, UserRole.FARMER.value}
UNMOVABLE_ROLES = {UserRole.COLLECTOR.value, UserRole.FARMER.value}


def user_json(user: User, cooperative: Optional[Cooperative] = None) -> dict:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "role": user.role_value,
        "is_active": bool(user.is_active),
        "cooperative_id": str(user.cooperative_id) if user.cooperative_id else None,
        "cooperative_name": cooperative.name if cooperative else None,
        "cooperative_code": cooperative.code if cooperative else None,
        "last_login_at": iso(user.last_login_at),
        "created_at": iso(user.created_at),
        "updated_at": iso(user.updated_at),
    }


def account_conflict(db: Session, *, email: Optional[str], phone: Optional[str], exclude_id: Optional[UUID] = None):
    def taken(column, value) -> bool:
        query = db.query(User.id).filter(column == value)
        if exclude_id:
            query = query.filter(User.id != exclude_id)
        return query.first() is not None

    if email and taken(User.email, email):
        return "email", "An account with this email address already exists."
    if phone and taken(User.phone_number, phone):
        return "phone", "This phone number already belongs to another account."
    return None


def _cooperative(db: Session, cooperative_id: Optional[UUID]) -> Cooperative:
    if cooperative_id is None:
        raise field_error("cooperative_id", "Choose the cooperative this account belongs to.")
    cooperative = db.get(Cooperative, cooperative_id)
    if cooperative is None:
        raise field_error("cooperative_id", "This cooperative doesn't exist.")
    return cooperative


def _save(db: Session, email: Optional[str], phone: Optional[str], exclude_id: Optional[UUID] = None) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        found = account_conflict(db, email=email, phone=phone, exclude_id=exclude_id)
        raise conflict(*(found or (None, "These details clash with another account.")))


def create(db: Session, principal: Principal, payload: UserCreate) -> User:
    role = payload.role.value
    found = account_conflict(db, email=payload.email, phone=payload.phone)
    if found:
        raise conflict(*found)

    cooperative = None
    farmer = None
    if role == UserRole.SUPER_ADMIN.value:
        if payload.cooperative_id is not None:
            raise field_error("cooperative_id", "Platform administrators don't belong to a cooperative.")
    else:
        cooperative = _cooperative(db, payload.cooperative_id)
    if role == UserRole.FARMER.value:
        if payload.farmer_id is None:
            raise field_error("farmer_id", "Choose the farmer record this account is for.")
        farmer = db.get(Farmer, payload.farmer_id)
        if farmer is None or farmer.cooperative_id != cooperative.id:
            raise field_error("farmer_id", "Choose a farmer from the same cooperative.")
        if farmer.user_id is not None:
            raise field_error("farmer_id", "This farmer already has an account.")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone_number=payload.phone,
        role=payload.role,
        cooperative_id=cooperative.id if cooperative else None,
        is_active=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict(*(account_conflict(db, email=payload.email, phone=payload.phone) or (None, "An account with these details already exists.")))
    if role == UserRole.COLLECTOR.value:
        collectors.ensure_profile(db, user)
    if farmer is not None:
        farmer.user_id = user.id
    audit.record(
        db, principal, "USER_CREATED",
        target=f"{user.full_name} <{user.email}> as {role}" + (f" in {cooperative.name}" if cooperative else ""),
        entity_type="user", entity_id=user.id, cooperative_id=cooperative.id if cooperative else None,
        new_values=snapshot(user, AUDITED),
    )
    _save(db, payload.email, payload.phone)
    db.refresh(user)
    return user


def update(db: Session, principal: Principal, user: User, payload: UserUpdate) -> User:
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "full_name", "email", "phone", "role")
    current_role = user.role_value
    new_role = data["role"].value if data.get("role") is not None else current_role

    if new_role != current_role:
        if user.id == principal.user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change your own role.")
        if current_role in FIXED_ROLES or new_role in FIXED_ROLES:
            raise field_error(
                "role", "Superadmin and farmer roles can't be given or taken away by editing. Create a new account instead."
            )

    if "cooperative_id" in data and data["cooperative_id"] != user.cooperative_id:
        if new_role == UserRole.SUPER_ADMIN.value:
            raise field_error("cooperative_id", "Platform administrators don't belong to a cooperative.")
        if current_role in UNMOVABLE_ROLES:
            raise field_error(
                "cooperative_id",
                "Collector and farmer accounts can't move to another cooperative; their records stay where they are.",
            )
        _cooperative(db, data["cooperative_id"])

    found = account_conflict(db, email=data.get("email"), phone=data.get("phone"), exclude_id=user.id)
    if found:
        raise conflict(*found)

    before = snapshot(user, AUDITED)
    if "full_name" in data:
        user.full_name = data["full_name"]
    if "email" in data:
        user.email = data["email"]
    if "phone" in data:
        user.phone_number = data["phone"]
    if "cooperative_id" in data and new_role != UserRole.SUPER_ADMIN.value:
        user.cooperative_id = data["cooperative_id"]
    if new_role != current_role:
        user.role = UserRole(new_role)
        if new_role == UserRole.COLLECTOR.value:
            collectors.ensure_profile(db, user)
        elif current_role == UserRole.COLLECTOR.value:
            profile = db.query(Collector).filter(Collector.user_id == user.id).first()
            if profile:
                profile.status = "INACTIVE"

    old, new = changed(before, snapshot(user, AUDITED))
    if new:
        action = "USER_ROLE_CHANGED" if "role" in new else "USER_COOPERATIVE_CHANGED" if "cooperative_id" in new else "USER_UPDATED"
        audit.record(
            db, principal, action, target=f"{user.full_name} <{user.email}>",
            entity_type="user", entity_id=user.id, cooperative_id=user.cooperative_id,
            old_values=old, new_values=new,
        )
    _save(db, data.get("email"), data.get("phone"), exclude_id=user.id)
    db.refresh(user)
    return user


def set_active(db: Session, principal: Principal, user: User, is_active: bool, reason: Optional[str]) -> User:
    if user.id == principal.user.id and not is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't deactivate your own account.")
    if bool(user.is_active) == is_active:
        return user
    if not is_active and user.role_value == UserRole.SUPER_ADMIN.value:
        others = (
            db.query(User.id)
            .filter(User.role == UserRole.SUPER_ADMIN, User.is_active.is_(True), User.id != user.id)
            .count()
        )
        if others == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "This is the last active superadmin; it can't be deactivated.")
    user.is_active = is_active
    audit.record(
        db, principal, "USER_ACTIVATED" if is_active else "USER_DISABLED",
        target=f"{user.full_name} <{user.email}>", entity_type="user", entity_id=user.id,
        cooperative_id=user.cooperative_id, old_values={"is_active": not is_active},
        new_values={"is_active": is_active}, reason=(reason or "").strip() or None,
    )
    db.commit()
    db.refresh(user)
    return user


def reset_password(db: Session, principal: Principal, user: User, password: str) -> None:
    user.password_hash = hash_password(password)
    audit.record(
        db, principal, "USER_PASSWORD_RESET", target=f"{user.full_name} <{user.email}>",
        entity_type="user", entity_id=user.id, cooperative_id=user.cooperative_id,
    )
    db.commit()
