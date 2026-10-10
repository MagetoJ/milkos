"""The farmer's own view: /api/v1/farmer (FARMER accounts only).

Everything is scoped to the farmer record linked to the signed-in account (core.access.Principal.farmer_profile);
no endpoint takes a farmer, cooperative or collection id from another farmer. Read-only: a farmer can't change
collections, prices, payments, their member number or their cooperative.

Amounts: a collection that has been paid shows the price stored on its payment line (the price actually used,
kept forever). One not yet paid shows the cooperative's price for its date as an ESTIMATE, labelled as such.
"""
import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.access import Principal, require_roles
from core.utils import iso, num, parse_uuid
from db import get_db
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.finance import FarmerPayment, FarmerPaymentLine, PaymentStatus
from models.notifications import Notification
from models.operations import CollectionBatch, Collector, LineStatus, MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from services import inbox, pricing

router = APIRouter(prefix="/api/v1/farmer", tags=["Farmer"])
farmer_only = require_roles(UserRole.FARMER)

RANGES = {"today": 0, "7d": 6, "30d": 29, "3m": 89}


def _farmer(principal: Principal) -> Farmer:
    return principal.farmer_profile()


def _price_lookup(db: Session, farmer: Farmer, lines: list[MilkCollection]) -> dict[UUID, tuple[Optional[Decimal], bool]]:
    """collection id -> (price per KG, is_estimate)."""
    if not lines:
        return {}
    paid = dict(
        db.query(FarmerPaymentLine.collection_id, FarmerPaymentLine.price_per_kg)
        .filter(FarmerPaymentLine.collection_id.in_([l.id for l in lines]), FarmerPaymentLine.is_active.is_(True))
        .all()
    )
    days = [l.collection_date for l in lines]
    prices = pricing.for_range(db, farmer.cooperative_id, min(days), max(days))
    out = {}
    for line in lines:
        if line.id in paid:
            out[line.id] = (paid[line.id], False)
        else:
            p = pricing.pick(prices, line.collection_date)
            out[line.id] = (p.price_per_kg if p else None, True)
    return out


def _receipts(db: Session, ids: list[UUID]) -> dict[UUID, Notification]:
    if not ids:
        return {}
    rows = (
        db.query(Notification)
        .filter(Notification.collection_id.in_(ids), Notification.type == "COLLECTION_RECEIPT")
        .order_by(Notification.created_at)
        .all()
    )
    return {n.collection_id: n for n in rows}


def _line_json(line: MilkCollection, price: tuple, receipt: Optional[Notification], names: dict) -> dict:
    price_per_kg, estimate = price if price else (None, True)
    payable = line.quality_status == QualityStatus.ACCEPTED and line.record_status == LineStatus.ACTIVE
    amount = (Decimal(line.quantity_kg) * Decimal(price_per_kg)).quantize(Decimal("0.01")) if price_per_kg is not None and payable else None
    return {
        "id": str(line.id),
        "reference": line.reference,
        "date": iso(line.collection_date),
        "time": line.collection_time.strftime("%H:%M") if line.collection_time else None,
        "quantity_kg": num(line.quantity_kg),
        "quantity_litres": num(line.quantity_litres),
        "quality_status": line.quality_status,
        "rejection_reason": line.rejection_reason,
        "fat_percentage": num(line.fat_percentage),
        "temperature_c": num(line.temperature_c),
        "record_status": line.record_status,
        "centre_name": names.get(("centre", line.centre_id)),
        "collector_name": names.get(("collector", line.collector_id)),
        "price_per_kg": num(price_per_kg),
        "price_is_estimate": bool(estimate),
        "amount": num(amount),
        "receipt_status": receipt.status if receipt else None,
        "receipt_sent_at": iso(receipt.sent_at) if receipt else None,
    }


def _names(db: Session, lines: list[MilkCollection]) -> dict:
    out = {}
    centre_ids = {l.centre_id for l in lines if l.centre_id}
    collector_ids = {l.collector_id for l in lines if l.collector_id}
    if centre_ids:
        for c in db.query(CollectionCentre).filter(CollectionCentre.id.in_(centre_ids)):
            out[("centre", c.id)] = c.name
    if collector_ids:
        for c, name in db.query(Collector, User.full_name).join(User, User.id == Collector.user_id).filter(Collector.id.in_(collector_ids)):
            out[("collector", c.id)] = name
    return out


def _serialize(db: Session, farmer: Farmer, lines: list[MilkCollection]) -> list[dict]:
    prices = _price_lookup(db, farmer, lines)
    receipts = _receipts(db, [l.id for l in lines])
    names = _names(db, lines)
    return [_line_json(l, prices.get(l.id), receipts.get(l.id), names) for l in lines]


@router.get("/dashboard")
def dashboard(
    range: str = Query("7d", pattern="^(today|7d|30d|3m|custom)$"),
    date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
    principal: Principal = Depends(farmer_only), db: Session = Depends(get_db),
):
    farmer = _farmer(principal)
    today = datetime.date.today()
    if range == "custom":
        if not date_from or not date_to or date_to < date_from or (date_to - date_from).days > 366:
            raise HTTPException(422, "Choose a custom period of at most one year.")
        start, end = date_from, date_to
    else:
        start, end = today - datetime.timedelta(days=RANGES[range]), today
    base = db.query(MilkCollection).filter(
        MilkCollection.farmer_id == farmer.id, MilkCollection.record_status == LineStatus.ACTIVE,
    )
    in_range = base.filter(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end).all()
    accepted = [l for l in in_range if l.quality_status == QualityStatus.ACCEPTED]
    prices = _price_lookup(db, farmer, accepted)
    earnings = sum(
        (Decimal(l.quantity_kg) * Decimal(prices[l.id][0])) for l in accepted if prices.get(l.id) and prices[l.id][0] is not None
    ) if accepted else Decimal(0)
    unpriced = sum(1 for l in accepted if not prices.get(l.id) or prices[l.id][0] is None)
    today_lines = [l for l in in_range if l.collection_date == today]
    # "This Month" is the calendar month to date whatever period the screen is showing (spec §15).
    month_lines = base.filter(MilkCollection.collection_date >= today.replace(day=1), MilkCollection.collection_date <= today).all()
    recent = base.order_by(MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc()).limit(5).all()
    daily: dict[str, float] = {}
    for l in accepted:
        key = l.collection_date.isoformat()
        daily[key] = round(daily.get(key, 0.0) + float(l.quantity_kg), 2)
    last_payment = (
        db.query(FarmerPayment).filter(FarmerPayment.farmer_id == farmer.id, FarmerPayment.status != PaymentStatus.CANCELLED)
        .order_by(FarmerPayment.period_end.desc()).first()
    )
    unread = inbox.visible(db, principal).filter(inbox.unread_filter(principal)).count()
    coop = db.get(Cooperative, farmer.cooperative_id)
    return {
        "farmer": {"name": farmer.full_name, "farmer_number": farmer.farmer_number, "cooperative_name": coop.name if coop else None},
        "period": {"range": range, "from": iso(start), "to": iso(end)},
        "today": {
            "kg": round(sum(float(l.quantity_kg) for l in today_lines if l.quality_status == QualityStatus.ACCEPTED), 2),
            "deliveries": len(today_lines),
        },
        "this_month": {
            "kg": round(sum(float(l.quantity_kg) for l in month_lines if l.quality_status == QualityStatus.ACCEPTED), 2),
            "deliveries": len(month_lines),
            "month": today.strftime("%Y-%m"),
        },
        "totals": {
            "kg": round(sum(float(l.quantity_kg) for l in accepted), 2),
            "litres": round(sum(float(l.quantity_litres) for l in accepted), 2),
            "deliveries": len(in_range),
            "rejected": sum(1 for l in in_range if l.quality_status == QualityStatus.REJECTED),
            "earnings": float(Decimal(earnings).quantize(Decimal("0.01"))),
            "earnings_is_estimate": True,
            "unpriced_deliveries": unpriced,
        },
        "daily": [{"date": d, "kg": kg} for d, kg in sorted(daily.items())],
        "recent": _serialize(db, farmer, recent),
        "last_payment": {
            "reference": last_payment.reference, "status": last_payment.status, "net_amount": num(last_payment.net_amount),
            "period_start": iso(last_payment.period_start), "period_end": iso(last_payment.period_end),
            "paid_at": iso(last_payment.paid_at),
        } if last_payment else None,
        "unread_notifications": unread,
    }


@router.get("/collections")
def my_collections(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
    principal: Principal = Depends(farmer_only), db: Session = Depends(get_db),
):
    farmer = _farmer(principal)
    query = db.query(MilkCollection).filter(MilkCollection.farmer_id == farmer.id)
    if date_from:
        query = query.filter(MilkCollection.collection_date >= date_from)
    if date_to:
        query = query.filter(MilkCollection.collection_date <= date_to)
    total = query.count()
    rows = (
        query.order_by(MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc(), MilkCollection.id)
        .offset((page - 1) * page_size).limit(page_size).all()
    )
    return {"items": _serialize(db, farmer, rows), "total": total, "page": page, "page_size": page_size}


@router.get("/collections/{collection_id}")
def my_collection(collection_id: str, principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    farmer = _farmer(principal)
    line = db.get(MilkCollection, parse_uuid(collection_id, "Collection"))
    # Another farmer's delivery looks exactly like a missing one.
    if line is None or line.farmer_id != farmer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    data = _serialize(db, farmer, [line])[0]
    batch = db.get(CollectionBatch, line.batch_id)
    cooler = db.get(Cooler, line.cooler_id) if line.cooler_id else None
    replacement = None
    if batch is not None and batch.superseded_by_batch_id:
        newer = db.query(MilkCollection).filter(
            MilkCollection.batch_id == batch.superseded_by_batch_id, MilkCollection.farmer_id == farmer.id
        ).first()
        replacement = str(newer.id) if newer else None
    payment = (
        db.query(FarmerPayment)
        .join(FarmerPaymentLine, FarmerPaymentLine.payment_id == FarmerPayment.id)
        .filter(FarmerPaymentLine.collection_id == line.id, FarmerPaymentLine.is_active.is_(True))
        .first()
    )
    return {
        **data,
        "cooler_name": cooler.name if cooler else None,
        "batch_reference": batch.reference if batch else None,
        "batch_status": batch.status if batch else None,
        "weight_source": batch.weight_source if batch else None,
        "replaced_by_collection_id": replacement,
        "payment": {"reference": payment.reference, "status": payment.status, "paid_at": iso(payment.paid_at)} if payment else None,
    }


@router.get("/payments")
def my_payments(principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    farmer = _farmer(principal)
    rows = (
        db.query(FarmerPayment).filter(FarmerPayment.farmer_id == farmer.id, FarmerPayment.status != PaymentStatus.CANCELLED)
        .order_by(FarmerPayment.period_end.desc()).limit(100).all()
    )
    return [
        {
            "id": str(p.id), "reference": p.reference, "period_start": iso(p.period_start), "period_end": iso(p.period_end),
            "total_kg": num(p.total_kg), "average_price_per_kg": num(p.average_price_per_kg),
            "gross_amount": num(p.gross_amount), "adjustments_amount": num(p.adjustments_amount), "net_amount": num(p.net_amount),
            "currency": p.currency, "status": p.status, "paid_at": iso(p.paid_at),
        }
        for p in rows
    ]


@router.get("/prices")
def price_history(principal: Principal = Depends(farmer_only), db: Session = Depends(get_db)):
    """The cooperative's milk prices over time (what each delivery was or will be paid at)."""
    farmer = _farmer(principal)
    from models.finance import MilkPrice, PriceStatus

    rows = (
        db.query(MilkPrice).filter(MilkPrice.cooperative_id == farmer.cooperative_id, MilkPrice.status == PriceStatus.ACTIVE)
        .order_by(MilkPrice.effective_from.desc()).limit(50).all()
    )
    return [
        {"price_per_kg": num(p.price_per_kg), "effective_from": iso(p.effective_from), "effective_to": iso(p.effective_to)}
        for p in rows
    ]
