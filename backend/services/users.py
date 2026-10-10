"""User accounts managed by the superadmin.

Rules (enforced here, not in the UI):
- SUPER_ADMIN accounts have no cooperative; every other role must belong to one.
- New accounts start PENDING_ACTIVATION with no password; the person activates from the SMS link and sets their
  own password (services/accounts). Administrators never set or see passwords.
- Platform, cooperative-admin and manager accounts need an email address; collectors and farmers may sign in with
  their phone number alone. Phone numbers are unique across all accounts (one account per number: it is a
  sign-in identifier and the channel for activation and reset messages).
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
from core.utils import changed, conflict, field_error, iso, reject_nulls, snapshot
from core.validation import mask_phone_local
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector
from models.user import AccountStatus, User
from schemas.auth import UserRole
from schemas.platform import UserCreate, UserUpdate
from services import accounts, audit, collectors, security_events

AUDITED = ("full_name", "email", "phone_number", "role", "cooperative_id", "is_active")
FIXED_ROLES = {UserRole.SUPER_ADMIN.value, UserRole.FARMER.value}
UNMOVABLE_ROLES = {UserRole.COLLECTOR.value, UserRole.FARMER.value}
EMAIL_REQUIRED_ROLES = {UserRole.SUPER_ADMIN.value, UserRole.COOP_ADMIN.value, UserRole.MANAGER.value}


def user_json(user: User, cooperative: Optional[Cooperative] = None, db: Optional[Session] = None) -> dict:
    data = {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "phone_masked": mask_phone_local(user.phone_number),
        "phone_verified": user.phone_verified_at is not None,
        "role": user.role_value,
        "is_active": bool(user.is_active),
        "account_status": user.status_value,
        "status_reason": user.status_reason,
        "mfa_enabled": bool(user.mfa_enabled),
        "cooperative_id": str(user.cooperative_id) if user.cooperative_id else None,
        "cooperative_name": cooperative.name if cooperative else None,
        "cooperative_code": cooperative.code if cooperative else None,
        "invited_at": iso(user.invited_at),
        "activated_at": iso(user.activated_at),
        "last_login_at": iso(user.last_login_at),
        "created_at": iso(user.created_at),
        "updated_at": iso(user.updated_at),
    }
    if db is not None:
        data["activation"] = accounts.activation_summary(db, user)
    return data


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


def require_email(role: str, email: Optional[str]) -> None:
    if role in EMAIL_REQUIRED_ROLES and not email:
        raise field_error("email", "Administrators and managers need an email address.")


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


def create(db: Session, principal: Principal, payload: UserCreate) -> tuple[User, Optional[accounts.PendingSms]]:
    """Create a PENDING_ACTIVATION account and queue its activation SMS. Returns (user, sms to dispatch)."""
    role = payload.role.value
    require_email(role, payload.email)
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

    user = accounts.new_pending_user(
        full_name=payload.full_name, phone=payload.phone, role=payload.role, email=payload.email,
        cooperative_id=cooperative.id if cooperative else None, invited_by=principal.user.id,
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
        target=f"{user.label} as {role}" + (f" in {cooperative.name}" if cooperative else ""),
        entity_type="user", entity_id=user.id, cooperative_id=cooperative.id if cooperative else None,
        new_values={**snapshot(user, AUDITED), "account_status": user.status_value},
    )
    pending = accounts.invite(db, principal, user)
    _save(db, payload.email, payload.phone)
    db.refresh(user)
    return user, pending


def update(db: Session, principal: Principal, user: User, payload: UserUpdate) -> tuple[User, Optional[accounts.PendingSms]]:
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
        require_email(new_role, data.get("email", user.email))

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
    old_phone = user.phone_number
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
        # A new role takes effect now: sessions signed in under the old one end.
        user.session_epoch = (user.session_epoch or 0) + 1
        security_events.from_principal(db, principal, "ROLE_CHANGED", user=user, details={"from": current_role, "to": new_role})
        if new_role == UserRole.COLLECTOR.value:
            collectors.ensure_profile(db, user)
        elif current_role == UserRole.COLLECTOR.value:
            profile = db.query(Collector).filter(Collector.user_id == user.id).first()
            if profile:
                profile.status = "INACTIVE"
    pending = accounts.phone_changed_by_admin(db, principal, user, old_phone)

    old, new = changed(before, snapshot(user, AUDITED))
    if new:
        action = "USER_ROLE_CHANGED" if "role" in new else "USER_COOPERATIVE_CHANGED" if "cooperative_id" in new else "USER_UPDATED"
        audit.record(
            db, principal, action, target=user.label,
            entity_type="user", entity_id=user.id, cooperative_id=user.cooperative_id,
            old_values=old, new_values=new,
        )
    _save(db, data.get("email"), data.get("phone"), exclude_id=user.id)
    db.refresh(user)
    return user, pending


def change_status(db: Session, principal: Principal, user: User, new_status: str, reason: Optional[str]):
    """ACTIVE / SUSPENDED / DISABLED with an audit entry; collectors' profiles follow their account."""
    before = user.status_value
    user, pending = accounts.change_status(db, principal, user, new_status, reason)
    if user.status_value != before:
        audit.record(
            db, principal, "USER_ACTIVATED" if user.is_active else "USER_DISABLED" if new_status == AccountStatus.DISABLED else "USER_SUSPENDED",
            target=user.label, entity_type="user", entity_id=user.id, cooperative_id=user.cooperative_id,
            old_values={"account_status": before}, new_values={"account_status": user.status_value},
            reason=(reason or "").strip() or None,
        )
        if user.role_value == UserRole.COLLECTOR.value:
            profile = db.query(Collector).filter(Collector.user_id == user.id).first()
            if profile is not None:
                profile.status = "ACTIVE" if user.status_value in (AccountStatus.ACTIVE, AccountStatus.PENDING_ACTIVATION) else "INACTIVE"
        db.commit()
        db.refresh(user)
    return user, pending


def set_active(db: Session, principal: Principal, user: User, is_active: bool, reason: Optional[str]):
    """The original on/off switch: on = ACTIVE (or a fresh activation link if no password was ever set), off = DISABLED."""
    return change_status(db, principal, user, AccountStatus.ACTIVE if is_active else AccountStatus.DISABLED, reason)
