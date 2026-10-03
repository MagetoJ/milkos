"""Cooperatives as managed by the superadmin."""
import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.onboarding import generate_cooperative_code
from core.security import hash_password
from core.utils import changed, conflict, iso, num, reject_nulls, snapshot
from models.admin import Cooler, CoolerStatus
from models.cooperative import Cooperative, CooperativeStatus
from models.farmer import Farmer
from models.operations import Collector, MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CooperativeCreate, CooperativeUpdate
from services import audit
from services.users import account_conflict

AUDITED = (
    "name", "registration_number", "kra_pin", "county", "location", "contact_email", "contact_phone",
    "estimated_daily_liters", "status", "suspension_reason",
)


def cooperative_json(coop: Cooperative, counts: Optional[dict] = None) -> dict:
    data = {
        "id": str(coop.id),
        "name": coop.name,
        "code": coop.code,
        "registration_number": coop.registration_number,
        "kra_pin": coop.kra_pin,
        "county": coop.county,
        "location": coop.location,
        "contact_email": coop.contact_email,
        "contact_phone": coop.contact_phone,
        "status": coop.status,
        "suspension_reason": coop.suspension_reason,
        "suspended_at": iso(coop.suspended_at),
        "sms_credit_balance": coop.sms_credit_balance or 0,
        "estimated_daily_liters": num(coop.estimated_daily_liters),
        "created_at": iso(coop.created_at),
        "updated_at": iso(coop.updated_at),
    }
    if counts is not None:
        data["counts"] = counts
    return data


def _empty_counts() -> dict:
    return {"farmers": 0, "collectors": 0, "managers": 0, "admins": 0, "coolers": 0, "litres_30d": 0.0}


def counts_for(db: Session, coop_ids: list[UUID]) -> dict[UUID, dict]:
    """Per-cooperative headline numbers for a page of cooperatives: one grouped query per table."""
    out = {cid: _empty_counts() for cid in coop_ids}
    if not coop_ids:
        return out
    for cid, n in (
        db.query(Farmer.cooperative_id, func.count(Farmer.id))
        .filter(Farmer.cooperative_id.in_(coop_ids), Farmer.status == "ACTIVE").group_by(Farmer.cooperative_id)
    ):
        out[cid]["farmers"] = n
    for cid, n in (
        db.query(Collector.cooperative_id, func.count(Collector.id))
        .filter(Collector.cooperative_id.in_(coop_ids), Collector.status == "ACTIVE").group_by(Collector.cooperative_id)
    ):
        out[cid]["collectors"] = n
    for cid, role, n in (
        db.query(User.cooperative_id, User.role, func.count(User.id))
        .filter(User.cooperative_id.in_(coop_ids), User.is_active.is_(True),
                User.role.in_([UserRole.MANAGER, UserRole.COOP_ADMIN]))
        .group_by(User.cooperative_id, User.role)
    ):
        key = "managers" if role == UserRole.MANAGER else "admins"
        out[cid][key] = n
    for cid, n in (
        db.query(Cooler.cooperative_id, func.count(Cooler.id))
        .filter(Cooler.cooperative_id.in_(coop_ids), Cooler.status == CoolerStatus.ACTIVE).group_by(Cooler.cooperative_id)
    ):
        out[cid]["coolers"] = n
    since = datetime.datetime.utcnow().date() - datetime.timedelta(days=29)
    for cid, litres in (
        db.query(MilkCollection.cooperative_id, func.coalesce(func.sum(MilkCollection.quantity_litres), 0))
        .filter(MilkCollection.cooperative_id.in_(coop_ids), MilkCollection.collection_date >= since,
                MilkCollection.quality_status == QualityStatus.ACCEPTED)
        .group_by(MilkCollection.cooperative_id)
    ):
        out[cid]["litres_30d"] = num(litres) or 0.0
    return out


def milk_volumes(db: Session, cooperative_id: Optional[UUID] = None) -> dict:
    """Accepted litres today, in the last 7 days and the last 30 days, in one query."""
    today = datetime.datetime.utcnow().date()
    week, month = today - datetime.timedelta(days=6), today - datetime.timedelta(days=29)
    q = MilkCollection.quantity_litres
    d = MilkCollection.collection_date
    query = db.query(
        func.coalesce(func.sum(case((d == today, q), else_=0)), 0),
        func.coalesce(func.sum(case((d >= week, q), else_=0)), 0),
        func.coalesce(func.sum(case((d >= month, q), else_=0)), 0),
        func.coalesce(func.sum(case((d == today, 1), else_=0)), 0),
    ).filter(MilkCollection.quality_status == QualityStatus.ACCEPTED, d >= month)
    if cooperative_id is not None:
        query = query.filter(MilkCollection.cooperative_id == cooperative_id)
    t, w, m, n = query.one()
    return {"today": num(t) or 0.0, "week": num(w) or 0.0, "month": num(m) or 0.0, "collections_today": int(n or 0)}


def _identity_conflict(db: Session, *, registration_number=None, kra_pin=None, exclude_id=None):
    def taken(column, value):
        query = db.query(Cooperative.id).filter(column == value)
        if exclude_id:
            query = query.filter(Cooperative.id != exclude_id)
        return query.first() is not None

    if registration_number and taken(Cooperative.registration_number, registration_number):
        return "registration_number", "Another cooperative already has this registration number."
    if kra_pin and taken(Cooperative.kra_pin, kra_pin):
        return "kra_pin", "Another cooperative already has this KRA PIN."
    return None


def create(db: Session, principal: Principal, payload: CooperativeCreate) -> Cooperative:
    found = _identity_conflict(db, registration_number=payload.registration_number, kra_pin=payload.kra_pin)
    if found:
        raise conflict(*found)
    if payload.admin:
        found = account_conflict(db, email=payload.admin.email, phone=payload.admin.phone)
        if found:
            raise conflict(f"admin.{found[0]}", found[1])

    coop = Cooperative(
        name=payload.name,
        code=generate_cooperative_code(db, payload.name),
        registration_number=payload.registration_number,
        kra_pin=payload.kra_pin,
        county=payload.county,
        location=payload.location,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        estimated_daily_liters=payload.estimated_daily_liters,
        status=CooperativeStatus.ACTIVE,
    )
    try:
        db.add(coop)
        db.flush()
        audit.record(
            db, principal, "COOPERATIVE_CREATED", target=f"{coop.name} ({coop.code})",
            entity_type="cooperative", entity_id=coop.id, cooperative_id=coop.id,
            new_values=snapshot(coop, AUDITED),
        )
        if payload.admin:
            admin = User(
                email=payload.admin.email, password_hash=hash_password(payload.admin.password),
                full_name=payload.admin.full_name, phone_number=payload.admin.phone,
                role=UserRole.COOP_ADMIN, cooperative_id=coop.id, is_active=True,
            )
            db.add(admin)
            db.flush()
            audit.record(
                db, principal, "USER_CREATED", target=f"{admin.full_name} <{admin.email}> as COOP_ADMIN in {coop.name}",
                entity_type="user", entity_id=admin.id, cooperative_id=coop.id,
                new_values={"email": admin.email, "role": "COOP_ADMIN"},
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        found = _identity_conflict(db, registration_number=payload.registration_number, kra_pin=payload.kra_pin)
        raise conflict(*(found or (None, "A cooperative or account with these details already exists.")))
    db.refresh(coop)
    return coop


def update(db: Session, principal: Principal, coop: Cooperative, payload: CooperativeUpdate) -> Cooperative:
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "name", "registration_number", "kra_pin", "county")
    found = _identity_conflict(
        db, registration_number=data.get("registration_number"), kra_pin=data.get("kra_pin"), exclude_id=coop.id
    )
    if found:
        raise conflict(*found)

    before = snapshot(coop, AUDITED)
    for name, value in data.items():
        setattr(coop, name, value)
    old, new = changed(before, snapshot(coop, AUDITED))
    if new:
        audit.record(
            db, principal, "COOPERATIVE_UPDATED", target=f"{coop.name} ({coop.code})",
            entity_type="cooperative", entity_id=coop.id, cooperative_id=coop.id, old_values=old, new_values=new,
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict(None, "Another cooperative already has this registration number or KRA PIN.")
    db.refresh(coop)
    return coop


def set_status(db: Session, principal: Principal, coop_id: UUID, new_status: str, reason: Optional[str]) -> Cooperative:
    # Row lock (Postgres) so two superadmins changing the status at once are serialised.
    coop = db.get(Cooperative, coop_id, with_for_update=True)
    if coop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooperative not found")
    if coop.status == new_status:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This cooperative is already {new_status.lower()}.")
    old = {"status": coop.status, "suspension_reason": coop.suspension_reason}
    coop.status = new_status
    if new_status == CooperativeStatus.SUSPENDED:
        coop.suspension_reason = (reason or "").strip()
        coop.suspended_at = datetime.datetime.utcnow()
        action = "COOPERATIVE_SUSPENDED"
    else:
        coop.suspension_reason = None
        coop.suspended_at = None
        action = "COOPERATIVE_ACTIVATED"
    audit.record(
        db, principal, action, target=f"{coop.name} ({coop.code})", entity_type="cooperative", entity_id=coop.id,
        cooperative_id=coop.id, old_values=old,
        new_values={"status": coop.status}, reason=(reason or "").strip() or None,
    )
    db.commit()
    db.refresh(coop)
    return coop


def adjust_sms_credits(db: Session, principal: Principal, coop_id: UUID, delta: int, reason: str) -> Cooperative:
    coop = db.get(Cooperative, coop_id, with_for_update=True)
    if coop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooperative not found")
    before = coop.sms_credit_balance or 0
    if before + delta < 0:
        raise HTTPException(
            422,
            f"The balance is {before:,} credits; you can remove at most that many.",
        )
    coop.sms_credit_balance = before + delta
    audit.record(
        db, principal, "SMS_CREDITS_ADJUSTED",
        target=f"{coop.name} ({coop.code}): {delta:+,} credits, balance {before:,} → {coop.sms_credit_balance:,}",
        entity_type="cooperative", entity_id=coop.id, cooperative_id=coop.id,
        old_values={"sms_credit_balance": before},
        new_values={"sms_credit_balance": coop.sms_credit_balance, "delta": delta}, reason=reason.strip(),
    )
    db.commit()
    db.refresh(coop)
    return coop


def search_filter(query, search: Optional[str]):
    from core.utils import like

    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            Cooperative.name.ilike(pattern, escape="\\"),
            Cooperative.code.ilike(pattern, escape="\\"),
            Cooperative.registration_number.ilike(pattern, escape="\\"),
            Cooperative.county.ilike(pattern, escape="\\"),
            Cooperative.location.ilike(pattern, escape="\\"),
        ))
    return query
