"""Farmer records: one implementation used by the cooperative workspace and the superadmin."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import (
    conflict, field_error, iso, like, next_sequence, num, phone_digits, reject_nulls, snapshot, changed,
)
from core.validation import normalize_phone
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import MilkCollection, QualityStatus
from schemas.cooperative_module import FarmerCreate, FarmerUpdate
from services import audit
from services.common import SyncOrigin, check_centre, target_cooperative

AUDITED = (
    "farmer_number", "first_name", "last_name", "phone", "national_id", "village", "centre_id",
    "number_of_cows", "payment_method", "payment_account", "bank_name", "status",
)


def farmer_json(farmer: Farmer, centre_name: Optional[str] = None, cooperative: Optional[Cooperative] = None) -> dict:
    data = {
        "id": str(farmer.id),
        "cooperative_id": str(farmer.cooperative_id),
        "farmer_number": farmer.farmer_number,
        "first_name": farmer.first_name,
        "last_name": farmer.last_name,
        "full_name": farmer.full_name,
        "phone": farmer.phone,
        "national_id": farmer.national_id,
        "village": farmer.village,
        "number_of_cows": farmer.number_of_cows,
        "payment_method": farmer.payment_method,
        "payment_account": farmer.payment_account,
        "bank_name": farmer.bank_name,
        "status": farmer.status,
        "centre_id": str(farmer.centre_id) if farmer.centre_id else None,
        "centre_name": centre_name,
        "has_account": farmer.user_id is not None,
        "created_at": iso(farmer.created_at),
        "updated_at": iso(farmer.updated_at),
        "sync_version": farmer.sync_version,
    }
    if cooperative is not None:
        data["cooperative_name"] = cooperative.name
        data["cooperative_code"] = cooperative.code
    return data


def find_conflict(
    db: Session, cooperative_id: UUID, *, number: Optional[str], phone: Optional[str], national_id: Optional[str],
    exclude_id: Optional[UUID] = None,
) -> Optional[tuple[str, str]]:
    def taken(column, value) -> bool:
        query = db.query(Farmer.id).filter(Farmer.cooperative_id == cooperative_id, column == value)
        if exclude_id:
            query = query.filter(Farmer.id != exclude_id)
        return query.first() is not None

    if number and taken(Farmer.farmer_number, number):
        return "farmer_number", "This farmer number is already used in this cooperative."
    if phone and taken(Farmer.phone, phone):
        return "phone", "A farmer with this phone number is already registered in this cooperative."
    if national_id and taken(Farmer.national_id, national_id):
        return "national_id", "A farmer with this national ID is already registered in this cooperative."
    return None


def _apply_payment_rules(farmer: Farmer) -> None:
    """Keep payout details consistent: M-Pesa needs a phone, a bank needs an account and bank name."""
    if farmer.payment_method == "MPESA":
        try:
            farmer.payment_account = normalize_phone(farmer.payment_account or farmer.phone)
        except ValueError as exc:
            raise field_error("payment_account", str(exc))
        farmer.bank_name = None
    elif farmer.payment_method == "BANK":
        if not farmer.payment_account:
            raise field_error("payment_account", "Enter the bank account number.")
        if not farmer.bank_name:
            raise field_error("bank_name", "Enter the bank's name.")
    else:
        if farmer.payment_account or farmer.bank_name:
            raise field_error("payment_method", "Choose how this farmer is paid (M-Pesa or bank).")


def search_filter(query, search: Optional[str]):
    """Every word must match somewhere: "jane limuru" finds Jane in Limuru."""
    for term in (search or "").split():
        clauses = [
            column.ilike(like(term), escape="\\")
            for column in (Farmer.first_name, Farmer.last_name, Farmer.farmer_number, Farmer.national_id, Farmer.village)
        ]
        digits = phone_digits(term)
        if digits:
            clauses.append(Farmer.phone.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))
    return query


def create(
    db: Session, principal: Principal, payload: FarmerCreate, origin: Optional[SyncOrigin] = None,
) -> tuple[Farmer, Optional[CollectionCentre]]:
    cooperative = target_cooperative(db, principal, payload.cooperative_id)
    centre = check_centre(db, cooperative.id, payload.centre_id)
    explicit_number = payload.farmer_number is not None

    for attempt in range(3):
        number = payload.farmer_number or next_sequence(
            (row[0] for row in db.query(Farmer.farmer_number).filter(Farmer.cooperative_id == cooperative.id)),
            "F", 4,
        )
        found = find_conflict(
            db, cooperative.id, number=number if explicit_number else None,
            phone=payload.phone, national_id=payload.national_id,
        )
        if found:
            raise conflict(*found)

        farmer = Farmer(
            **(origin.id_kwargs() if origin else {}),
            cooperative_id=cooperative.id,
            centre_id=payload.centre_id,
            farmer_number=number,
            first_name=payload.first_name,
            last_name=payload.last_name,
            phone=payload.phone,
            national_id=payload.national_id,
            village=payload.village,
            number_of_cows=payload.number_of_cows,
            payment_method=payload.payment_method,
            payment_account=payload.payment_account,
            bank_name=payload.bank_name,
            status="ACTIVE",
        )
        _apply_payment_rules(farmer)
        db.add(farmer)
        try:
            db.flush()
            audit.record(
                db, principal, "FARMER_CREATED",
                target=f"{farmer.full_name} ({farmer.farmer_number}) in {cooperative.name}",
                entity_type="farmer", entity_id=farmer.id, cooperative_id=cooperative.id,
                new_values=snapshot(farmer, AUDITED),
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            # A simultaneous request took a unique value. Re-check which one; retry an auto number.
            found = find_conflict(db, cooperative.id, number=number, phone=payload.phone, national_id=payload.national_id)
            if found and (explicit_number or found[0] != "farmer_number" or attempt == 2):
                raise conflict(*found)
            if not found and attempt == 2:
                raise conflict(None, "These details clash with another farmer. Refresh and try again.")
            continue
        db.refresh(farmer)
        return farmer, centre
    raise conflict(None, "Could not allocate a farmer number. Try again.")  # pragma: no cover


def update(db: Session, principal: Principal, farmer: Farmer, payload: FarmerUpdate) -> Farmer:
    data = payload.model_dump(exclude_unset=True)
    data.pop("cooperative_id", None)  # a farmer never moves between cooperatives
    reject_nulls(data, "first_name", "last_name", "phone", "farmer_number", "status")

    if data.get("centre_id") is not None:
        check_centre(db, farmer.cooperative_id, data["centre_id"])
    found = find_conflict(
        db, farmer.cooperative_id,
        number=data.get("farmer_number"), phone=data.get("phone"), national_id=data.get("national_id"),
        exclude_id=farmer.id,
    )
    if found:
        raise conflict(*found)

    before = snapshot(farmer, AUDITED)
    for name, value in data.items():
        setattr(farmer, name, value)
    pending = None
    if farmer.user_id is not None and "phone" in data:
        # The farmer's app account signs in with the same number: move it too, unverified until the farmer confirms.
        from models.user import User
        from services import accounts
        from services.users import account_conflict

        account = db.get(User, farmer.user_id)
        if account is not None and account.phone_number != farmer.phone:
            if account_conflict(db, email=None, phone=farmer.phone, exclude_id=account.id):
                raise conflict("phone", "This phone number already belongs to another MilkOS account.")
            old_phone = account.phone_number
            account.phone_number = farmer.phone
            pending = accounts.phone_changed_by_admin(db, principal, account, old_phone)
    if farmer.user_id is not None and "status" in data:
        # An inactive member can't sign in; reactivating restores the account (or its pending activation).
        from models.user import AccountStatus, User

        account = db.get(User, farmer.user_id)
        if account is not None:
            if farmer.status != "ACTIVE" and account.status_value in (AccountStatus.ACTIVE, AccountStatus.PENDING_ACTIVATION):
                account.set_status(AccountStatus.DISABLED, "Farmer deactivated by the cooperative")
            elif farmer.status == "ACTIVE" and account.status_value == AccountStatus.DISABLED \
                    and account.status_reason == "Farmer deactivated by the cooperative":
                account.set_status(AccountStatus.ACTIVE if account.password_hash else AccountStatus.PENDING_ACTIVATION)
    if "payment_method" in data and data["payment_method"] is None:
        farmer.payment_account = farmer.bank_name = None
    _apply_payment_rules(farmer)

    old, new = changed(before, snapshot(farmer, AUDITED))
    if new:
        status_only = set(new) == {"status"}
        action = (
            ("FARMER_ACTIVATED" if farmer.status == "ACTIVE" else "FARMER_DEACTIVATED") if status_only else "FARMER_UPDATED"
        )
        audit.record(
            db, principal, action, target=f"{farmer.full_name} ({farmer.farmer_number})",
            entity_type="farmer", entity_id=farmer.id, cooperative_id=farmer.cooperative_id,
            old_values=old, new_values=new,
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        found = find_conflict(
            db, farmer.cooperative_id, number=data.get("farmer_number"), phone=data.get("phone"),
            national_id=data.get("national_id"), exclude_id=farmer.id,
        )
        raise conflict(*(found or (None, "These details clash with another farmer. Refresh and try again.")))
    if pending is not None:
        from services import accounts

        accounts.dispatch(db, pending)
    db.refresh(farmer)
    return farmer


def collection_stats(db: Session, farmer_ids: list[UUID]) -> dict[UUID, dict]:
    """Accepted litres, delivery count and last delivery per farmer, in one query."""
    if not farmer_ids:
        return {}
    rows = (
        db.query(
            MilkCollection.farmer_id,
            func.coalesce(func.sum(MilkCollection.quantity_litres), 0),
            func.count(MilkCollection.id),
            func.max(MilkCollection.collection_date),
        )
        .filter(MilkCollection.farmer_id.in_(farmer_ids), MilkCollection.quality_status == QualityStatus.ACCEPTED,
                MilkCollection.record_status == "ACTIVE")
        .group_by(MilkCollection.farmer_id)
        .all()
    )
    return {
        fid: {"total_litres": num(litres) or 0.0, "collections": count, "last_collection": iso(last)}
        for fid, litres, count, last in rows
    }
