"""Collector profiles. A collector is a COLLECTOR user plus this operational profile."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import changed, conflict, field_error, iso, next_sequence, num, reject_nulls, snapshot
from models.admin import Cooler
from models.cooperative import Cooperative
from models.operations import Collector, MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CollectorCreate, CollectorUpdate
from services import audit
from services.common import check_centre, target_cooperative

AUDITED = ("collector_number", "assigned_area", "centre_id", "cooler_id", "status")


def _next_number(db: Session, cooperative_id: UUID) -> str:
    return next_sequence(
        (row[0] for row in db.query(Collector.collector_number).filter(Collector.cooperative_id == cooperative_id)),
        "COL", 3,
    )


def ensure_profile(db: Session, user: User) -> Collector:
    """Give a COLLECTOR user an active profile in their cooperative (creating it if needed). Flushes, never commits."""
    profile = db.query(Collector).filter(Collector.user_id == user.id).first()
    if profile is None:
        profile = Collector(
            user_id=user.id, cooperative_id=user.cooperative_id,
            collector_number=_next_number(db, user.cooperative_id), status="ACTIVE",
        )
        db.add(profile)
    else:
        if profile.cooperative_id != user.cooperative_id:
            profile.cooperative_id = user.cooperative_id
            profile.collector_number = _next_number(db, user.cooperative_id)
            profile.centre_id = profile.cooler_id = None
        profile.status = "ACTIVE"
    db.flush()
    return profile


def check_cooler(db: Session, cooperative_id: UUID, cooler_id: Optional[UUID]) -> Optional[Cooler]:
    if cooler_id is None:
        return None
    cooler = db.get(Cooler, cooler_id)
    if cooler is None or cooler.cooperative_id != cooperative_id:
        raise field_error("cooler_id", "Choose a cooler from the same cooperative.")
    return cooler


def collector_json(
    collector: Collector, user: User, *, cooperative: Optional[Cooperative] = None,
    centre_name: Optional[str] = None, cooler_name: Optional[str] = None, stats: Optional[dict] = None,
) -> dict:
    data = {
        "id": str(collector.id),
        "user_id": str(user.id),
        "cooperative_id": str(collector.cooperative_id),
        "collector_number": collector.collector_number,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone_number,
        "assigned_area": collector.assigned_area,
        "centre_id": str(collector.centre_id) if collector.centre_id else None,
        "centre_name": centre_name,
        "cooler_id": str(collector.cooler_id) if collector.cooler_id else None,
        "cooler_name": cooler_name,
        "status": collector.status,
        "account_active": bool(user.is_active),
        "account_status": user.status_value,
        "phone_verified": user.phone_verified_at is not None,
        "created_at": iso(collector.created_at),
        "updated_at": iso(collector.updated_at),
        "stats": stats or {"total_litres": 0.0, "collections": 0, "last_collection": None},
    }
    if cooperative is not None:
        data["cooperative_name"] = cooperative.name
        data["cooperative_code"] = cooperative.code
    return data


def stats_for(db: Session, collector_ids: list[UUID]) -> dict[UUID, dict]:
    if not collector_ids:
        return {}
    rows = (
        db.query(
            MilkCollection.collector_id,
            func.coalesce(func.sum(MilkCollection.quantity_litres), 0),
            func.count(MilkCollection.id),
            func.max(MilkCollection.collection_date),
        )
        .filter(MilkCollection.collector_id.in_(collector_ids), MilkCollection.quality_status == QualityStatus.ACCEPTED,
                MilkCollection.record_status == "ACTIVE")
        .group_by(MilkCollection.collector_id)
        .all()
    )
    return {cid: {"total_litres": num(l) or 0.0, "collections": c, "last_collection": iso(last)} for cid, l, c, last in rows}


def _number_taken(db: Session, cooperative_id: UUID, number: str, exclude_id: Optional[UUID] = None) -> bool:
    query = db.query(Collector.id).filter(Collector.cooperative_id == cooperative_id, Collector.collector_number == number)
    if exclude_id:
        query = query.filter(Collector.id != exclude_id)
    return query.first() is not None


def create(db: Session, principal: Principal, payload: CollectorCreate):
    """A PENDING_ACTIVATION collector account + profile. Returns (profile, activation SMS to dispatch after commit)."""
    from services import accounts
    from services.users import account_conflict  # local: users imports this module

    cooperative = target_cooperative(db, principal, payload.cooperative_id)
    check_centre(db, cooperative.id, payload.centre_id)
    check_cooler(db, cooperative.id, payload.cooler_id)
    found = account_conflict(db, email=payload.email, phone=payload.phone)
    if found:
        raise conflict(*found)
    if payload.collector_number and _number_taken(db, cooperative.id, payload.collector_number):
        raise conflict("collector_number", "This collector number is already used in this cooperative.")

    user = accounts.new_pending_user(
        full_name=payload.full_name, phone=payload.phone, role=UserRole.COLLECTOR, email=payload.email,
        cooperative_id=cooperative.id, invited_by=principal.user.id,
    )
    db.add(user)
    try:
        db.flush()
        profile = Collector(
            user_id=user.id, cooperative_id=cooperative.id,
            collector_number=payload.collector_number or _next_number(db, cooperative.id),
            assigned_area=payload.assigned_area, centre_id=payload.centre_id, cooler_id=payload.cooler_id,
            status="ACTIVE",
        )
        db.add(profile)
        db.flush()
        audit.record(
            db, principal, "COLLECTOR_CREATED",
            target=f"{user.full_name} ({profile.collector_number}) in {cooperative.name}",
            entity_type="collector", entity_id=profile.id, cooperative_id=cooperative.id,
            new_values={**snapshot(profile, AUDITED), "email": user.email, "phone": user.phone_number},
        )
        pending = accounts.invite(db, principal, user)
        db.commit()
    except IntegrityError:
        db.rollback()
        found = account_conflict(db, email=payload.email, phone=payload.phone)
        raise conflict(*(found or ("collector_number", "This collector number is already used in this cooperative.")))
    db.refresh(profile)
    return profile, pending


def update(db: Session, principal: Principal, profile: Collector, payload: CollectorUpdate) -> Collector:
    from models.user import AccountStatus
    from services import accounts
    from services.users import account_conflict

    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "full_name", "phone", "collector_number", "status")
    user = db.get(User, profile.user_id)
    if "centre_id" in data:
        check_centre(db, profile.cooperative_id, data["centre_id"])
    if "cooler_id" in data:
        check_cooler(db, profile.cooperative_id, data["cooler_id"])
    if data.get("collector_number") and _number_taken(db, profile.cooperative_id, data["collector_number"], profile.id):
        raise conflict("collector_number", "This collector number is already used in this cooperative.")
    found = account_conflict(db, email=None, phone=data.get("phone"), exclude_id=user.id)
    if found:
        raise conflict(*found)

    before = {**snapshot(profile, AUDITED), "full_name": user.full_name, "phone": user.phone_number}
    old_phone = user.phone_number
    for name in ("collector_number", "assigned_area", "centre_id", "cooler_id", "status"):
        if name in data:
            setattr(profile, name, data[name])
    if "full_name" in data:
        user.full_name = data["full_name"]
    if "phone" in data:
        user.phone_number = data["phone"]
    if "status" in data:
        # The profile and the login go together: an inactive collector can't sign in. A collector who never
        # activated stays waiting for activation when switched back on.
        if data["status"] != "ACTIVE":
            if user.status_value != AccountStatus.DISABLED:
                user.set_status(AccountStatus.DISABLED, "Collector deactivated")
        elif user.status_value in (AccountStatus.DISABLED, AccountStatus.SUSPENDED):
            user.set_status(AccountStatus.ACTIVE if user.password_hash else AccountStatus.PENDING_ACTIVATION)
    pending = accounts.phone_changed_by_admin(db, principal, user, old_phone)

    old, new = changed(before, {**snapshot(profile, AUDITED), "full_name": user.full_name, "phone": user.phone_number})
    if new:
        action = (
            ("COLLECTOR_ACTIVATED" if profile.status == "ACTIVE" else "COLLECTOR_DEACTIVATED")
            if set(new) == {"status"} else "COLLECTOR_UPDATED"
        )
        audit.record(
            db, principal, action, target=f"{user.full_name} ({profile.collector_number})",
            entity_type="collector", entity_id=profile.id, cooperative_id=profile.cooperative_id,
            old_values=old, new_values=new,
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict(None, "These details clash with another collector or account. Refresh and try again.")
    accounts.dispatch(db, pending)
    db.refresh(profile)
    return profile
