"""Milk prices per KG, per cooperative, by date.

A price is valid from effective_from to effective_to (inclusive; NULL = until replaced). Prices are never
edited: adding a newer price closes the open-ended one before it (effective_to = new start - 1 day), and a
price that any farmer payment used can't be cancelled. Payment lines store the price they used, so old
payments keep their pricing context forever.
"""
import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import field_error, iso, num
from models.finance import FarmerPaymentLine, MilkPrice, PriceStatus
from schemas.finance import PriceCreate
from services import audit, inbox

DAY = datetime.timedelta(days=1)


def price_json(p: MilkPrice, used: bool = False) -> dict:
    return {
        "id": str(p.id),
        "cooperative_id": str(p.cooperative_id),
        "effective_from": iso(p.effective_from),
        "effective_to": iso(p.effective_to),
        "price_per_kg": num(p.price_per_kg),
        "currency": p.currency,
        "status": p.status,
        "notes": p.notes,
        "created_by": str(p.created_by) if p.created_by else None,
        "created_at": iso(p.created_at),
        "cancelled_at": iso(p.cancelled_at),
        "cancel_reason": p.cancel_reason,
        "used_by_payments": used,
    }


def active(db: Session, cooperative_id: UUID):
    return db.query(MilkPrice).filter(MilkPrice.cooperative_id == cooperative_id, MilkPrice.status == PriceStatus.ACTIVE)


def overlapping(db: Session, cooperative_id: UUID, start: datetime.date, end: Optional[datetime.date]):
    query = active(db, cooperative_id).filter(or_(MilkPrice.effective_to.is_(None), MilkPrice.effective_to >= start))
    if end is not None:
        query = query.filter(MilkPrice.effective_from <= end)
    return query


def applicable(db: Session, cooperative_id: UUID, day: datetime.date) -> Optional[MilkPrice]:
    return (
        active(db, cooperative_id)
        .filter(MilkPrice.effective_from <= day, or_(MilkPrice.effective_to.is_(None), MilkPrice.effective_to >= day))
        .order_by(MilkPrice.effective_from.desc())
        .first()
    )


def for_range(db: Session, cooperative_id: UUID, start: datetime.date, end: datetime.date) -> list[MilkPrice]:
    return overlapping(db, cooperative_id, start, end).order_by(MilkPrice.effective_from).all()


def pick(prices: list[MilkPrice], day: datetime.date) -> Optional[MilkPrice]:
    found = None
    for p in prices:
        if p.effective_from <= day and (p.effective_to is None or p.effective_to >= day):
            if found is None or p.effective_from > found.effective_from:
                found = p
    return found


def _paid_from(db: Session, cooperative_id: UUID, start: datetime.date) -> bool:
    """Has milk on or after `start` already been included in a live farmer payment?"""
    return db.query(FarmerPaymentLine.id).join(MilkPrice, MilkPrice.id == FarmerPaymentLine.price_id).filter(
        MilkPrice.cooperative_id == cooperative_id, FarmerPaymentLine.is_active.is_(True),
        FarmerPaymentLine.collection_date >= start,
    ).first() is not None


def create(db: Session, principal: Principal, payload: PriceCreate) -> MilkPrice:
    coop_id = principal.cooperative_id
    if _paid_from(db, coop_id, payload.effective_from):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Milk from that date has already been included in farmer payments. Start the new price after the last paid date.",
        )
    clashes = overlapping(db, coop_id, payload.effective_from, payload.effective_to).all()
    closed: Optional[MilkPrice] = None
    for p in clashes:
        # The only overlap allowed: an open-ended earlier price, which the new price closes.
        if p.effective_to is None and p.effective_from < payload.effective_from and closed is None:
            closed = p
            continue
        raise field_error(
            "effective_from",
            f"Overlaps the price of KES {num(p.price_per_kg):,.2f}/KG from {iso(p.effective_from)}"
            f"{' to ' + iso(p.effective_to) if p.effective_to else ''}. Prices can't overlap.",
        )
    if payload.effective_to is None:
        later = active(db, coop_id).filter(MilkPrice.effective_from > payload.effective_from).order_by(MilkPrice.effective_from).first()
        if later is not None:
            raise field_error("effective_to", f"A later price starts on {iso(later.effective_from)}; give this one an end date before it.")
    if closed is not None:
        closed.effective_to = payload.effective_from - DAY
    price = MilkPrice(
        cooperative_id=coop_id, effective_from=payload.effective_from, effective_to=payload.effective_to,
        price_per_kg=payload.price_per_kg, notes=payload.notes, created_by=principal.user.id, status=PriceStatus.ACTIVE,
    )
    db.add(price)
    db.flush()
    audit.record(
        db, principal, "MILK_PRICE_CREATED",
        target=f"KES {payload.price_per_kg:,.2f}/KG from {iso(payload.effective_from)}"
               + (f" to {iso(payload.effective_to)}" if payload.effective_to else ""),
        entity_type="milk_price", entity_id=price.id, cooperative_id=coop_id,
        old_values={"closed_price": str(closed.id), "closed_effective_to": None} if closed else None,
        new_values={**price_json(price), **({"closed_price_effective_to": iso(closed.effective_to)} if closed else {})},
    )
    inbox.notify(
        db, cooperative_id=coop_id, roles=("COOP_ADMIN", "MANAGER"), category="PAYMENT", type="MILK_PRICE_CREATED",
        title=f"New milk price: KES {payload.price_per_kg:,.2f}/KG from {iso(payload.effective_from)}",
        entity_type="milk_price", entity_id=price.id, link="/cooperatives/pricing",
    )
    db.commit()
    db.refresh(price)
    return price


def cancel(db: Session, principal: Principal, price: MilkPrice, reason: str) -> MilkPrice:
    if price.status != PriceStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "This price was already cancelled.")
    if db.query(FarmerPaymentLine.id).filter(FarmerPaymentLine.price_id == price.id).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Farmer payments used this price, so it can't be cancelled. Add a new price instead.")
    price.status = PriceStatus.CANCELLED
    price.cancelled_by = principal.user.id
    price.cancelled_at = datetime.datetime.utcnow()
    price.cancel_reason = reason
    audit.record(
        db, principal, "MILK_PRICE_CANCELLED", target=f"KES {num(price.price_per_kg):,.2f}/KG from {iso(price.effective_from)}",
        entity_type="milk_price", entity_id=price.id, cooperative_id=price.cooperative_id,
        old_values={"status": PriceStatus.ACTIVE}, new_values={"status": PriceStatus.CANCELLED}, reason=reason,
    )
    db.commit()
    db.refresh(price)
    return price


def used_ids(db: Session, price_ids: list[UUID]) -> set[UUID]:
    if not price_ids:
        return set()
    return {row[0] for row in db.query(FarmerPaymentLine.price_id).filter(FarmerPaymentLine.price_id.in_(price_ids)).distinct()}


def missing_days(prices: list[MilkPrice], days: set[datetime.date]) -> list[datetime.date]:
    return sorted(d for d in days if pick(prices, d) is None)


