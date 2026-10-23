"""A cooperative's people: staff accounts (admins, managers, collectors) and farmers' sign-in accounts.

Accounts are created PENDING_ACTIVATION and texted a one-time activation link; the person sets their own
password. A cooperative admin manages its managers', collectors' and farmers' accounts (never another admin's,
never anyone outside the cooperative) and helps people back in with a reset link, never by setting a password.

Functions that text someone return the Notification of that SMS (or None): the caller reports whether it went.
"""
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.utils import conflict, iso, reject_nulls
from app.core.validation import mask_phone_local
from app.domain.exceptions import NotFound, PermissionDenied
from app.domain.schemas.auth import UserRole
from app.domain.schemas.cooperative_module import TeamCreate, TeamUpdate
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.notifications import Notification
from app.infrastructure.db.models.operations import Collector
from app.infrastructure.db.models.user import AccountStatus, User
from app.services import accounts, audit, collectors, security_events, users
from app.services.principal import Principal, own
from app.services.users import account_conflict, require_email

TEAM_ROLES = (UserRole.COOP_ADMIN, UserRole.MANAGER, UserRole.COLLECTOR)
_ROLE_ORDER = {UserRole.COOP_ADMIN.value: 0, UserRole.MANAGER.value: 1, UserRole.COLLECTOR.value: 2}


def member_json(db: Session, user: User, current: User) -> dict:
    return {
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
        "is_you": user.id == current.id,
        "last_login_at": iso(user.last_login_at),
        "created_at": iso(user.created_at),
        "activation": accounts.activation_summary(db, user),
    }


def list_team(db: Session, principal: Principal) -> list[User]:
    members = (
        db.query(User)
        .filter(User.cooperative_id == principal.cooperative_id, User.role.in_(TEAM_ROLES))
        .order_by(User.full_name)
        .all()
    )
    members.sort(key=lambda u: (_ROLE_ORDER.get(u.role_value, 9), u.full_name.lower()))
    return members


def list_accounts(db: Session, principal: Principal, role: Optional[UserRole], account_status: Optional[str],
                  search: Optional[str]) -> list[User]:
    """Every sign-in account of the caller's cooperative (staff and farmers)."""
    query = db.query(User).filter(User.cooperative_id == principal.cooperative_id)
    if role:
        query = query.filter(User.role == role)
    if account_status:
        query = query.filter(User.account_status == account_status)
    query = users.search_filter(query, search)
    return query.order_by(User.full_name).limit(500).all()


def own_member(db: Session, principal: Principal, member_id: str) -> User:
    """A manager or collector of the caller's cooperative (404 for anyone else; the admin can't be changed here)."""
    member = own(db, principal, User, member_id, "Team member")
    if member.role_value == UserRole.COOP_ADMIN.value:
        raise PermissionDenied("The cooperative admin's account can't be changed here.")
    if member.role_value not in {UserRole.MANAGER.value, UserRole.COLLECTOR.value}:
        raise NotFound("Team member")
    return member


def own_account(db: Session, principal: Principal, account_id: str) -> User:
    """Any account of the caller's cooperative (404 for anyone else's)."""
    return own(db, principal, User, account_id, "Account")


def _collector_status(user: User) -> str:
    """A collector profile is active while its account is active or waiting for activation."""
    return "ACTIVE" if user.status_value in (AccountStatus.ACTIVE, AccountStatus.PENDING_ACTIVATION) else "INACTIVE"


def _sync_collector_profile(db: Session, user: User) -> None:
    """Keep the collector profile in step with the account."""
    profile = db.query(Collector).filter(Collector.user_id == user.id).first()
    if user.role_value == UserRole.COLLECTOR.value:
        profile = collectors.ensure_profile(db, user)
        profile.status = _collector_status(user)
    elif profile is not None:
        profile.status = "INACTIVE"


def create_member(db: Session, principal: Principal, payload: TeamCreate) -> tuple[User, Optional[Notification]]:
    """Invite a manager or collector. Commits, then texts the activation link."""
    require_email(payload.role, payload.email)
    clash = account_conflict(db, email=payload.email, phone=payload.phone)
    if clash:
        raise conflict(*clash)

    member = accounts.new_pending_user(
        full_name=payload.full_name, phone=payload.phone, role=UserRole(payload.role), email=payload.email,
        cooperative_id=principal.cooperative_id, invited_by=principal.user.id,
    )
    db.add(member)
    try:
        db.flush()
        if payload.role == UserRole.COLLECTOR.value:
            collectors.ensure_profile(db, member)
        audit.record(
            db, principal, "USER_CREATED", target=f"{member.label} as {payload.role}",
            entity_type="user", entity_id=member.id, cooperative_id=principal.cooperative_id,
            new_values={"email": member.email, "role": payload.role, "account_status": member.status_value},
        )
        pending = accounts.invite(db, principal, member)
        db.commit()
    except IntegrityError:
        db.rollback()
        clash = account_conflict(db, email=payload.email, phone=payload.phone)
        raise conflict(*(clash or (None, "An account with these details already exists.")))
    sms = accounts.dispatch(db, pending, ip=principal.ip_address, ua=principal.user_agent)
    db.refresh(member)
    return member, sms


def update_member(db: Session, principal: Principal, member: User, payload: TeamUpdate) -> tuple[User, Optional[Notification]]:
    """Name, phone, role (manager <-> collector) and active flag. Commits; texts the new number if it changed."""
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "full_name", "phone", "role", "is_active")

    clash = account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
    if clash:
        raise conflict(*clash)

    old_role = member.role_value
    old_phone = member.phone_number
    if "full_name" in data:
        member.full_name = data["full_name"]
    if "phone" in data:
        member.phone_number = data["phone"]
    if "role" in data and data["role"] != old_role:
        if data["role"] == UserRole.MANAGER.value and not member.email:
            raise conflict("role", "Add an email address before making this person a manager.")
        member.role = UserRole(data["role"])
        member.session_epoch = (member.session_epoch or 0) + 1  # the new role applies from the next request
        security_events.from_principal(db, principal, "ROLE_CHANGED", user=member, details={"from": old_role, "to": data["role"]})
    if "is_active" in data and data["is_active"] != bool(member.is_active):
        if data["is_active"]:
            member.set_status(AccountStatus.ACTIVE if member.password_hash else AccountStatus.PENDING_ACTIVATION)
        else:
            member.set_status(AccountStatus.DISABLED, "Deactivated by the cooperative admin")
        security_events.from_principal(
            db, principal, "ACCOUNT_REACTIVATED" if data["is_active"] else "ACCOUNT_DISABLED", user=member,
        )
    pending = accounts.phone_changed_by_admin(db, principal, member, old_phone)
    _sync_collector_profile(db, member)

    action = (
        "USER_ROLE_CHANGED" if member.role_value != old_role
        else ("USER_ACTIVATED" if member.is_active else "USER_DISABLED") if set(data) == {"is_active"}
        else "USER_UPDATED"
    )
    audit.record(
        db, principal, action, target=member.label,
        entity_type="user", entity_id=member.id, cooperative_id=principal.cooperative_id,
        old_values={"role": old_role} if member.role_value != old_role else None, new_values=data or None,
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        clash = account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
        raise conflict(*(clash or (None, "These details clash with another account.")))
    sms = accounts.dispatch(db, pending)
    db.refresh(member)
    return member, sms


def resend_activation(db: Session, principal: Principal, user: User) -> Optional[Notification]:
    sms = accounts.dispatch(db, accounts.resend_activation(db, principal, user))
    db.refresh(user)
    return sms


def set_status(db: Session, principal: Principal, user: User, status: str, reason: Optional[str]) -> tuple[User, Optional[Notification]]:
    user, pending = accounts.change_status(db, principal, user, status, reason)
    if user.role_value == UserRole.COLLECTOR.value:
        profile = db.query(Collector).filter(Collector.user_id == user.id).first()
        if profile is not None:
            profile.status = _collector_status(user)
            db.commit()
    sms = accounts.dispatch(db, pending)
    db.refresh(user)
    return user, sms


def send_password_reset(db: Session, principal: Principal, user: User) -> Optional[Notification]:
    """Text the person a password reset link. The admin never sets, sees or receives the password."""
    return accounts.dispatch(db, accounts.admin_password_reset(db, principal, user))


def invite_farmer(db: Session, principal: Principal, farmer: Farmer) -> tuple[User, Optional[Notification]]:
    """Give a farmer the MilkOS app: a FARMER account on the farmer's registered phone, activated by SMS link."""
    taken = "This farmer's phone number already belongs to another MilkOS account."
    if farmer.user_id is not None:
        raise conflict(None, "This farmer already has an account.")
    if farmer.status != "ACTIVE":
        raise conflict(None, "Reactivate this farmer before giving them an account.")
    if account_conflict(db, email=None, phone=farmer.phone):
        raise conflict("phone", taken)
    user = accounts.new_pending_user(
        full_name=farmer.full_name, phone=farmer.phone, role=UserRole.FARMER,
        cooperative_id=principal.cooperative_id, invited_by=principal.user.id,
    )
    db.add(user)
    try:
        db.flush()
        farmer.user_id = user.id
        audit.record(
            db, principal, "USER_CREATED", target=f"{user.label} for farmer {farmer.farmer_number}",
            entity_type="user", entity_id=user.id, cooperative_id=principal.cooperative_id,
            new_values={"role": "FARMER", "farmer_number": farmer.farmer_number, "account_status": user.status_value},
        )
        pending = accounts.invite(db, principal, user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("phone", taken)
    sms = accounts.dispatch(db, pending, ip=principal.ip_address, ua=principal.user_agent)
    db.refresh(user)
    return user, sms
