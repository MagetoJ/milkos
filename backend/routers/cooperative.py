"""Cooperative workspace API: overview, collection centres, farmers and team.

Every endpoint works on the logged-in user's own cooperative (users.cooperative_id). The cooperative is
never taken from the URL or the request body, so one cooperative cannot read or change another's data.

  COOP_ADMIN  everything below
  MANAGER     read everything; create and edit centres and farmers; cannot change the team
"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.security import hash_password
from db import get_db
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative, CooperativeStatus
from models.farmer import Farmer
from models.user import User
from routers.auth import conflict_error, get_current_user
from schemas.auth import UserRole
from schemas.cooperative_module import (
    CentreCreate,
    CentreUpdate,
    FarmerCreate,
    FarmerUpdate,
    TeamCreate,
    TeamUpdate,
)

router = APIRouter(prefix="/api/v1/cooperative", tags=["Cooperative"])
logger = logging.getLogger("milkflow.cooperative")

TEAM_ROLES = (UserRole.COOP_ADMIN, UserRole.MANAGER, UserRole.COLLECTOR)


# ---------------- who is calling, and for which cooperative ----------------

@dataclass
class Ctx:
    user: User
    cooperative: Cooperative

    @property
    def role(self) -> str:
        return role_value(self.user)


def role_value(user: User) -> str:
    return user.role.value if isinstance(user.role, UserRole) else str(user.role)


def _context(allowed: set[UserRole]):
    allowed_values = {role.value for role in allowed}

    def dependency(payload: dict = Depends(get_current_user), db: Session = Depends(get_db)) -> Ctx:
        try:
            user = db.get(User, UUID(payload["sub"]))
        except (ValueError, KeyError):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token subject")
        # Role, activation and cooperative come from the database, not the (up to 15-minute-old) token,
        # so deactivating someone cuts off access immediately.
        if not user or not user.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or inactive")
        if role_value(user) not in allowed_values:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
        if not user.cooperative_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is not linked to a cooperative.")
        cooperative = db.get(Cooperative, user.cooperative_id)
        if not cooperative:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is not linked to a cooperative.")
        if cooperative.status != CooperativeStatus.ACTIVE:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "This cooperative is suspended. Contact the platform administrator."
            )
        return Ctx(user=user, cooperative=cooperative)

    return dependency


staff = _context({UserRole.COOP_ADMIN, UserRole.MANAGER})
admin_only = _context({UserRole.COOP_ADMIN})


# ---------------- helpers ----------------

def _iso(value: Optional[datetime]) -> Optional[str]:
    """Columns store naive UTC; mark them as UTC so browsers don't read them as local time."""
    if value is None:
        return None
    return value.isoformat() + ("Z" if value.tzinfo is None else "")


def _uuid(value: str, what: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def _field_error(field: str, message: str) -> HTTPException:
    """422 shaped like FastAPI's own validation errors so forms map it to the field."""
    return HTTPException(
        422,
        detail=[{"loc": ["body", field], "msg": message, "type": "invalid"}],
    )


def _reject_nulls(data: dict, *fields: str) -> None:
    for field in fields:
        if field in data and data[field] is None:
            raise _field_error(field, "This field can't be empty.")


def _next_sequence(values: Iterable[Optional[str]], prefix: str, width: int) -> str:
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for value in values:
        match = pattern.match(value or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}-{highest + 1:0{width}d}"


def _own(db: Session, model, raw_id: str, ctx: Ctx, what: str):
    row = db.get(model, _uuid(raw_id, what))
    # Someone else's row looks exactly like a missing one.
    if row is None or row.cooperative_id != ctx.cooperative.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return row


def _check_manager(db: Session, ctx: Ctx, manager_user_id: Optional[UUID]) -> None:
    if manager_user_id is None:
        return
    manager = db.get(User, manager_user_id)
    if (
        manager is None
        or manager.cooperative_id != ctx.cooperative.id
        or role_value(manager) != UserRole.MANAGER.value
        or not manager.is_active
    ):
        raise _field_error("manager_user_id", "Choose an active manager from your team.")


def _check_centre(db: Session, ctx: Ctx, centre_id: Optional[UUID]) -> Optional[CollectionCentre]:
    if centre_id is None:
        return None
    centre = db.get(CollectionCentre, centre_id)
    if centre is None or centre.cooperative_id != ctx.cooperative.id:
        raise _field_error("centre_id", "Choose a collection centre from your own cooperative.")
    return centre


# ---------------- overview ----------------

@router.get("/overview")
def overview(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    coop = ctx.cooperative

    def count(model, *conditions) -> int:
        return db.query(func.count(model.id)).filter(model.cooperative_id == coop.id, *conditions).scalar() or 0

    team_counts = dict(
        db.query(User.role, func.count(User.id))
        .filter(User.cooperative_id == coop.id, User.is_active.is_(True), User.role.in_(TEAM_ROLES))
        .group_by(User.role)
        .all()
    )
    recent = (
        db.query(Farmer)
        .filter(Farmer.cooperative_id == coop.id)
        .order_by(Farmer.created_at.desc(), Farmer.farmer_number.desc())
        .limit(5)
        .all()
    )

    return {
        "role": ctx.role,
        "cooperative": {
            "name": coop.name,
            "code": coop.code,
            "county": coop.county,
            "location": coop.location,
            "status": coop.status,
            "sms_credit_balance": coop.sms_credit_balance or 0,
            "estimated_daily_liters": float(coop.estimated_daily_liters) if coop.estimated_daily_liters is not None else None,
            "created_at": _iso(coop.created_at),
        },
        "farmers": {
            "total": count(Farmer),
            "active": count(Farmer, Farmer.status == "ACTIVE"),
            "unassigned": count(Farmer, Farmer.status == "ACTIVE", Farmer.centre_id.is_(None)),
        },
        "centres": {
            "total": count(CollectionCentre),
            "active": count(CollectionCentre, CollectionCentre.status == "ACTIVE"),
            "with_cooler": count(CollectionCentre, CollectionCentre.status == "ACTIVE", CollectionCentre.has_cooler.is_(True)),
        },
        "coolers": {
            "total": count(Cooler),
            "operational": count(Cooler, Cooler.is_operational.is_(True)),
        },
        "team": {
            "admins": team_counts.get(UserRole.COOP_ADMIN, 0),
            "managers": team_counts.get(UserRole.MANAGER, 0),
            "collectors": team_counts.get(UserRole.COLLECTOR, 0),
        },
        "recent_farmers": [
            {
                "id": str(f.id),
                "farmer_number": f.farmer_number,
                "full_name": f"{f.first_name} {f.last_name}",
                "phone": f.phone,
                "created_at": _iso(f.created_at),
            }
            for f in recent
        ],
    }


# ---------------- collection centres ----------------

def _centre_json(centre: CollectionCentre, farmer_count: int = 0, manager_name: Optional[str] = None) -> dict:
    return {
        "id": str(centre.id),
        "name": centre.name,
        "code": centre.code,
        "county": centre.county,
        "location_description": centre.location_description,
        "manager_user_id": str(centre.manager_user_id) if centre.manager_user_id else None,
        "manager_name": manager_name,
        "has_cooler": bool(centre.has_cooler),
        "cooler_capacity_litres": float(centre.cooler_capacity_litres) if centre.cooler_capacity_litres is not None else None,
        "status": centre.status,
        "farmer_count": farmer_count,
        "created_at": _iso(centre.created_at),
    }


def _manager_names(db: Session, ids: set) -> dict:
    if not ids:
        return {}
    return {u.id: u.full_name for u in db.query(User).filter(User.id.in_(ids)).all()}


def _centre_code_taken(db: Session, ctx: Ctx, code: str, exclude_id: Optional[UUID] = None) -> bool:
    query = db.query(CollectionCentre.id).filter(
        CollectionCentre.cooperative_id == ctx.cooperative.id, CollectionCentre.code == code
    )
    if exclude_id:
        query = query.filter(CollectionCentre.id != exclude_id)
    return query.first() is not None


@router.get("/centres")
def list_centres(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    centres = (
        db.query(CollectionCentre)
        .filter(CollectionCentre.cooperative_id == ctx.cooperative.id)
        .order_by(CollectionCentre.name)
        .all()
    )
    farmer_counts = dict(
        db.query(Farmer.centre_id, func.count(Farmer.id))
        .filter(Farmer.cooperative_id == ctx.cooperative.id, Farmer.status == "ACTIVE", Farmer.centre_id.isnot(None))
        .group_by(Farmer.centre_id)
        .all()
    )
    names = _manager_names(db, {c.manager_user_id for c in centres if c.manager_user_id})
    return [_centre_json(c, farmer_counts.get(c.id, 0), names.get(c.manager_user_id)) for c in centres]


@router.post("/centres", status_code=status.HTTP_201_CREATED)
def create_centre(payload: CentreCreate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    _check_manager(db, ctx, payload.manager_user_id)
    explicit_code = payload.code is not None

    for attempt in range(3):
        code = payload.code or _next_sequence(
            (row[0] for row in db.query(CollectionCentre.code).filter(CollectionCentre.cooperative_id == ctx.cooperative.id)),
            "CTR", 3,
        )
        if _centre_code_taken(db, ctx, code):
            raise conflict_error("code", "Another centre in your cooperative already uses this code.")
        centre = CollectionCentre(
            cooperative_id=ctx.cooperative.id,
            name=payload.name,
            code=code,
            county=payload.county or ctx.cooperative.county,
            location_description=payload.location_description,
            manager_user_id=payload.manager_user_id,
            has_cooler=payload.has_cooler,
            cooler_capacity_litres=payload.cooler_capacity_litres if payload.has_cooler else None,
            status="ACTIVE",
        )
        db.add(centre)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if explicit_code or attempt == 2:
                raise conflict_error("code", "Another centre in your cooperative already uses this code.")
            continue
        db.refresh(centre)
        names = _manager_names(db, {centre.manager_user_id} if centre.manager_user_id else set())
        return _centre_json(centre, 0, names.get(centre.manager_user_id))


@router.patch("/centres/{centre_id}")
def update_centre(centre_id: str, payload: CentreUpdate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    centre = _own(db, CollectionCentre, centre_id, ctx, "Collection centre")
    data = payload.model_dump(exclude_unset=True)
    _reject_nulls(data, "name", "code", "county", "has_cooler", "status")

    if "manager_user_id" in data:
        _check_manager(db, ctx, data["manager_user_id"])
    if "code" in data and _centre_code_taken(db, ctx, data["code"], exclude_id=centre.id):
        raise conflict_error("code", "Another centre in your cooperative already uses this code.")

    for field, value in data.items():
        setattr(centre, field, value)
    if not centre.has_cooler:
        centre.cooler_capacity_litres = None

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict_error("code", "Another centre in your cooperative already uses this code.")
    db.refresh(centre)

    count = (
        db.query(func.count(Farmer.id))
        .filter(Farmer.centre_id == centre.id, Farmer.status == "ACTIVE")
        .scalar()
        or 0
    )
    names = _manager_names(db, {centre.manager_user_id} if centre.manager_user_id else set())
    return _centre_json(centre, count, names.get(centre.manager_user_id))


# ---------------- farmers ----------------

def _farmer_json(farmer: Farmer, centre_name: Optional[str] = None) -> dict:
    return {
        "id": str(farmer.id),
        "farmer_number": farmer.farmer_number,
        "first_name": farmer.first_name,
        "last_name": farmer.last_name,
        "full_name": f"{farmer.first_name} {farmer.last_name}",
        "phone": farmer.phone,
        "national_id": farmer.national_id,
        "village": farmer.village,
        "status": farmer.status,
        "centre_id": str(farmer.centre_id) if farmer.centre_id else None,
        "centre_name": centre_name,
        "created_at": _iso(farmer.created_at),
    }


def _farmer_conflict(
    db: Session, ctx: Ctx, *, number: Optional[str], phone: Optional[str], national_id: Optional[str],
    exclude_id: Optional[UUID] = None,
) -> Optional[tuple[str, str]]:
    def taken(column, value) -> bool:
        query = db.query(Farmer.id).filter(Farmer.cooperative_id == ctx.cooperative.id, column == value)
        if exclude_id:
            query = query.filter(Farmer.id != exclude_id)
        return query.first() is not None

    if number and taken(Farmer.farmer_number, number):
        return "farmer_number", "This farmer number is already used in your cooperative."
    if phone and taken(Farmer.phone, phone):
        return "phone", "A farmer with this phone number is already registered in your cooperative."
    if national_id and taken(Farmer.national_id, national_id):
        return "national_id", "A farmer with this national ID is already registered in your cooperative."
    return None


def _like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/farmers")
def list_farmers(
    search: Optional[str] = Query(None, max_length=100),
    centre_id: Optional[str] = Query(None, description="A centre id, or 'none' for farmers without a centre"),
    farmer_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    ctx: Ctx = Depends(staff),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Farmer, CollectionCentre.name)
        .outerjoin(CollectionCentre, Farmer.centre_id == CollectionCentre.id)
        .filter(Farmer.cooperative_id == ctx.cooperative.id)
    )

    if farmer_status:
        query = query.filter(Farmer.status == farmer_status)
    if centre_id == "none":
        query = query.filter(Farmer.centre_id.is_(None))
    elif centre_id:
        query = query.filter(Farmer.centre_id == _uuid(centre_id, "Collection centre"))

    # Every word must match somewhere: "jane limuru" finds Jane in Limuru.
    for term in (search or "").split():
        clauses = [
            column.ilike(_like(term), escape="\\")
            for column in (Farmer.first_name, Farmer.last_name, Farmer.farmer_number, Farmer.national_id, Farmer.village)
        ]
        if re.fullmatch(r"\+?\d+", term):
            digits = term.lstrip("+")
            digits = digits[1:] if digits.startswith("0") else digits[3:] if digits.startswith("254") else digits
            if len(digits) >= 3:
                clauses.append(Farmer.phone.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))

    total = query.count()
    rows = (
        query.order_by(Farmer.last_name, Farmer.first_name, Farmer.farmer_number)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [_farmer_json(farmer, centre_name) for farmer, centre_name in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/farmers", status_code=status.HTTP_201_CREATED)
def create_farmer(payload: FarmerCreate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    centre = _check_centre(db, ctx, payload.centre_id)
    explicit_number = payload.farmer_number is not None

    for attempt in range(3):
        number = payload.farmer_number or _next_sequence(
            (row[0] for row in db.query(Farmer.farmer_number).filter(Farmer.cooperative_id == ctx.cooperative.id)),
            "F", 4,
        )
        conflict = _farmer_conflict(
            db, ctx, number=number if explicit_number else None, phone=payload.phone, national_id=payload.national_id
        )
        if conflict:
            raise conflict_error(*conflict)

        farmer = Farmer(
            cooperative_id=ctx.cooperative.id,
            centre_id=payload.centre_id,
            farmer_number=number,
            first_name=payload.first_name,
            last_name=payload.last_name,
            phone=payload.phone,
            national_id=payload.national_id,
            village=payload.village,
            status="ACTIVE",
        )
        db.add(farmer)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # A simultaneous request took a unique value. Re-check which one; retry an auto number.
            conflict = _farmer_conflict(db, ctx, number=number, phone=payload.phone, national_id=payload.national_id)
            if conflict and (explicit_number or conflict[0] != "farmer_number" or attempt == 2):
                raise conflict_error(*conflict)
            continue
        db.refresh(farmer)
        return _farmer_json(farmer, centre.name if centre else None)


@router.patch("/farmers/{farmer_id}")
def update_farmer(farmer_id: str, payload: FarmerUpdate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    farmer = _own(db, Farmer, farmer_id, ctx, "Farmer")
    data = payload.model_dump(exclude_unset=True)
    _reject_nulls(data, "first_name", "last_name", "phone", "farmer_number", "status")

    if data.get("centre_id") is not None:
        _check_centre(db, ctx, data["centre_id"])
    conflict = _farmer_conflict(
        db, ctx,
        number=data.get("farmer_number"), phone=data.get("phone"), national_id=data.get("national_id"),
        exclude_id=farmer.id,
    )
    if conflict:
        raise conflict_error(*conflict)

    for field, value in data.items():
        setattr(farmer, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        conflict = _farmer_conflict(
            db, ctx, number=data.get("farmer_number"), phone=data.get("phone"),
            national_id=data.get("national_id"), exclude_id=farmer.id,
        )
        raise conflict_error(*(conflict or (None, "These details clash with another farmer. Refresh and try again.")))
    db.refresh(farmer)

    centre = db.get(CollectionCentre, farmer.centre_id) if farmer.centre_id else None
    return _farmer_json(farmer, centre.name if centre else None)


# ---------------- team ----------------

def _member_json(user: User, current: User) -> dict:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "role": role_value(user),
        "is_active": bool(user.is_active),
        "is_you": user.id == current.id,
        "created_at": _iso(user.created_at),
    }


def _account_conflict(db: Session, *, email: Optional[str], phone: Optional[str], exclude_id: Optional[UUID] = None):
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


@router.get("/team")
def list_team(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    members = (
        db.query(User)
        .filter(User.cooperative_id == ctx.cooperative.id, User.role.in_(TEAM_ROLES))
        .order_by(User.full_name)
        .all()
    )
    order = {UserRole.COOP_ADMIN.value: 0, UserRole.MANAGER.value: 1, UserRole.COLLECTOR.value: 2}
    members.sort(key=lambda u: (order.get(role_value(u), 9), u.full_name.lower()))
    return [_member_json(u, ctx.user) for u in members]


@router.post("/team", status_code=status.HTTP_201_CREATED)
def create_team_member(payload: TeamCreate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    conflict = _account_conflict(db, email=payload.email, phone=payload.phone)
    if conflict:
        raise conflict_error(*conflict)

    member = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone_number=payload.phone,
        role=UserRole(payload.role),
        cooperative_id=ctx.cooperative.id,
        is_active=True,
    )
    db.add(member)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        conflict = _account_conflict(db, email=payload.email, phone=payload.phone)
        raise conflict_error(*(conflict or (None, "An account with these details already exists.")))
    db.refresh(member)
    return _member_json(member, ctx.user)


@router.patch("/team/{member_id}")
def update_team_member(member_id: str, payload: TeamUpdate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    member = _own_member(db, member_id, ctx)
    data = payload.model_dump(exclude_unset=True)
    _reject_nulls(data, "full_name", "phone", "role", "is_active", "password")

    conflict = _account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
    if conflict:
        raise conflict_error(*conflict)

    if "full_name" in data:
        member.full_name = data["full_name"]
    if "phone" in data:
        member.phone_number = data["phone"]
    if "role" in data:
        member.role = UserRole(data["role"])
    if "is_active" in data:
        member.is_active = data["is_active"]
    if "password" in data:
        member.password_hash = hash_password(data["password"])

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        conflict = _account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
        raise conflict_error(*(conflict or (None, "These details clash with another account.")))
    db.refresh(member)
    return _member_json(member, ctx.user)


def _own_member(db: Session, member_id: str, ctx: Ctx) -> User:
    member = db.get(User, _uuid(member_id, "Team member"))
    if member is None or member.cooperative_id != ctx.cooperative.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    if role_value(member) == UserRole.COOP_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The cooperative admin's account can't be changed here.")
    if role_value(member) not in {UserRole.MANAGER.value, UserRole.COLLECTOR.value}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    return member