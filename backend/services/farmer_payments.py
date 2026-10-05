"""Farmer payments: eligible milk x the price applicable on each collection's date.

Eligible milk = ACTIVE allocation lines (not superseded or reversed), quality ACCEPTED, collected on or before
the period end, and not already in a live payment. Earlier unpaid lines (e.g. the replacement lines of a
correction approved after their period was paid) are carried into the next payment, priced at their own date.
Pending adjustments (negative for corrected/reversed milk that was paid) are applied to the farmer's next payment.

Status flow (models.finance.PaymentStatus.TRANSITIONS):
    PENDING -> PROCESSING -> PAID | FAILED;  PENDING -> PAID (manual, with a transaction reference)
    FAILED -> PROCESSING | PAID | CANCELLED;  PENDING -> CANCELLED
A payment is marked PAID only with a transaction reference: either a payout provider's confirmation or the
reference of a transfer a person made and recorded. Nothing here moves money by itself.
"""
import datetime
import secrets
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, exists
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import field_error, iso, num
from models.farmer import Farmer
from models.finance import (
    AdjustmentStatus, FarmerPayment, FarmerPaymentAdjustment, FarmerPaymentLine, PaymentStatus,
)
from models.operations import LineStatus, MilkCollection, QualityStatus
from services import audit, inbox, pricing

CENT = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _reference(db: Session, day: datetime.date) -> str:
    for _ in range(10):
        ref = f"FP-{day:%y%m}-{secrets.token_hex(3).upper()}"
        if not db.query(FarmerPayment.id).filter(FarmerPayment.reference == ref).first():
            return ref
    return f"FP-{day:%y%m}-{secrets.token_hex(6).upper()}"


def eligible_lines(db: Session, cooperative_id: UUID, period_end: datetime.date, farmer_ids: Optional[Iterable[UUID]] = None):
    paid = exists().where(and_(FarmerPaymentLine.collection_id == MilkCollection.id, FarmerPaymentLine.is_active.is_(True)))
    query = db.query(MilkCollection).filter(
        MilkCollection.cooperative_id == cooperative_id,
        MilkCollection.record_status == LineStatus.ACTIVE,
        MilkCollection.quality_status == QualityStatus.ACCEPTED,
        MilkCollection.collection_date <= period_end,
        ~paid,
    )
    if farmer_ids:
        query = query.filter(MilkCollection.farmer_id.in_(list(farmer_ids)))
    return query.order_by(MilkCollection.farmer_id, MilkCollection.collection_date, MilkCollection.reference)


def preview(db: Session, cooperative_id: UUID, start: datetime.date, end: datetime.date, farmer_ids=None) -> dict:
    """What `generate` would create, without saving anything."""
    lines = eligible_lines(db, cooperative_id, end, farmer_ids).all()
    prices = pricing.for_range(db, cooperative_id, min([l.collection_date for l in lines], default=start), end)
    missing = pricing.missing_days(prices, {l.collection_date for l in lines})
    by_farmer: dict[UUID, list] = defaultdict(list)
    for line in lines:
        by_farmer[line.farmer_id].append(line)
    adjustments = _pending_adjustments(db, cooperative_id, farmer_ids)
    total_kg = sum((Decimal(str(l.quantity_kg)) for l in lines), Decimal("0"))
    gross = Decimal("0")
    for line in lines:
        p = pricing.pick(prices, line.collection_date)
        if p is not None:
            gross += money(Decimal(str(line.quantity_kg)) * Decimal(str(p.price_per_kg)))
    adj_total = sum((Decimal(str(a.amount)) for rows in adjustments.values() for a in rows), Decimal("0"))
    return {
        "period_start": iso(start), "period_end": iso(end),
        "farmers": len(set(by_farmer) | set(adjustments)),
        "lines": len(lines),
        "carried_forward_lines": sum(1 for l in lines if l.collection_date < start),
        "total_kg": float(total_kg),
        "gross_amount": float(gross),
        "adjustments_amount": float(adj_total),
        "net_amount": float(gross + adj_total),
        "missing_price_dates": [iso(d) for d in missing],
    }


def _pending_adjustments(db: Session, cooperative_id: UUID, farmer_ids=None) -> dict[UUID, list[FarmerPaymentAdjustment]]:
    query = db.query(FarmerPaymentAdjustment).filter(
        FarmerPaymentAdjustment.cooperative_id == cooperative_id, FarmerPaymentAdjustment.status == AdjustmentStatus.PENDING,
    )
    if farmer_ids:
        query = query.filter(FarmerPaymentAdjustment.farmer_id.in_(list(farmer_ids)))
    out: dict[UUID, list] = defaultdict(list)
    for a in query.order_by(FarmerPaymentAdjustment.created_at):
        out[a.farmer_id].append(a)
    return out


def generate(db: Session, principal: Principal, start: datetime.date, end: datetime.date, farmer_ids=None) -> dict:
    coop_id = principal.cooperative_id
    lines = eligible_lines(db, coop_id, end, farmer_ids).all()
    prices = pricing.for_range(db, coop_id, min([l.collection_date for l in lines], default=start), end)
    missing = pricing.missing_days(prices, {l.collection_date for l in lines})
    if missing:
        listed = ", ".join(iso(d) for d in missing[:5]) + ("…" if len(missing) > 5 else "")
        raise field_error("period_start", f"No milk price applies on {listed}. Add a price covering these dates first.")

    by_farmer: dict[UUID, list[MilkCollection]] = defaultdict(list)
    for line in lines:
        by_farmer[line.farmer_id].append(line)
    adjustments = _pending_adjustments(db, coop_id, farmer_ids)
    farmers = {f.id: f for f in db.query(Farmer).filter(Farmer.id.in_(set(by_farmer) | set(adjustments)))} if (by_farmer or adjustments) else {}

    created, skipped = [], []
    for farmer_id in sorted(set(by_farmer) | set(adjustments), key=lambda fid: farmers[fid].farmer_number):
        farmer = farmers[farmer_id]
        clash = db.query(FarmerPayment.id).filter(
            FarmerPayment.farmer_id == farmer_id, FarmerPayment.period_start == start, FarmerPayment.period_end == end,
            FarmerPayment.status != PaymentStatus.CANCELLED,
        ).first()
        if clash:
            skipped.append({"farmer_id": str(farmer_id), "farmer_number": farmer.farmer_number,
                            "reason": "A payment for this farmer and period already exists."})
            continue
        payment = FarmerPayment(
            reference=_reference(db, end), cooperative_id=coop_id, farmer_id=farmer_id, period_start=start, period_end=end,
            total_kg=0, gross_amount=0, adjustments_amount=0, net_amount=0, status=PaymentStatus.PENDING,
            payment_method=farmer.payment_method, payment_account=farmer.payment_account or (farmer.phone if farmer.payment_method == "MPESA" else None),
            created_by=principal.user.id,
        )
        db.add(payment)
        db.flush()
        total_kg, gross = Decimal("0"), Decimal("0")
        for line in by_farmer.get(farmer_id, []):
            p = pricing.pick(prices, line.collection_date)
            quantity = Decimal(str(line.quantity_kg))
            amount = money(quantity * Decimal(str(p.price_per_kg)))
            db.add(FarmerPaymentLine(
                payment_id=payment.id, collection_id=line.id, collection_date=line.collection_date, quantity_kg=quantity,
                price_id=p.id, price_per_kg=p.price_per_kg, amount=amount, is_active=True,
            ))
            total_kg += quantity
            gross += amount
        adj_total = Decimal("0")
        for a in adjustments.get(farmer_id, []):
            a.status = AdjustmentStatus.APPLIED
            a.applied_payment_id = payment.id
            adj_total += Decimal(str(a.amount))
        payment.total_kg = total_kg
        payment.gross_amount = gross
        payment.adjustments_amount = adj_total
        payment.net_amount = gross + adj_total
        payment.average_price_per_kg = (gross / total_kg).quantize(Decimal("0.0001")) if total_kg else None
        created.append(payment)
    db.flush()
    audit.record(
        db, principal, "FARMER_PAYMENTS_GENERATED",
        target=f"{len(created)} farmer payment(s) for {iso(start)} – {iso(end)}",
        entity_type="farmer_payment_run", entity_id=f"{iso(start)}:{iso(end)}", cooperative_id=coop_id,
        new_values={
            "payments": [p.reference for p in created], "skipped": len(skipped),
            "net_total": float(sum((Decimal(str(p.net_amount)) for p in created), Decimal("0"))),
        },
    )
    if created:
        inbox.notify(
            db, cooperative_id=coop_id, roles=("COOP_ADMIN",), category="PAYMENT", type="FARMER_PAYMENTS_GENERATED",
            title=f"{len(created)} farmer payment(s) ready for {iso(start)} – {iso(end)}",
            body="Review them and record each transfer when it is made.", link="/cooperatives/payments",
        )
    db.commit()
    return {"created": [payment_json(p, farmers.get(p.farmer_id)) for p in created], "skipped": skipped}


def set_status(db: Session, principal: Principal, payment: FarmerPayment, new_status: str,
               reference: Optional[str], reason: Optional[str]) -> FarmerPayment:
    payment = db.get(FarmerPayment, payment.id, with_for_update=True)
    old = payment.status
    if new_status not in PaymentStatus.TRANSITIONS.get(old, set()):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {old.lower()} payment can't become {new_status.lower()}.")
    if new_status == PaymentStatus.PAID and not reference:
        raise field_error("payment_reference", "Enter the transaction reference of the payment (M-Pesa or bank).")
    if new_status in (PaymentStatus.FAILED, PaymentStatus.CANCELLED) and not (reason and len(reason) >= 3):
        raise field_error("reason", "Say why.")
    now = datetime.datetime.utcnow()
    payment.status = new_status
    if reference:
        payment.payment_reference = reference
    if new_status == PaymentStatus.PAID:
        payment.paid_at = now
        payment.provider = payment.provider or "MANUAL"
        payment.failure_reason = None
    elif new_status == PaymentStatus.FAILED:
        payment.failure_reason = reason
    elif new_status == PaymentStatus.CANCELLED:
        payment.failure_reason = reason
        # Release its milk and adjustments for the next payment run.
        for line in db.query(FarmerPaymentLine).filter(FarmerPaymentLine.payment_id == payment.id):
            line.is_active = False
        for a in db.query(FarmerPaymentAdjustment).filter(FarmerPaymentAdjustment.applied_payment_id == payment.id):
            a.status = AdjustmentStatus.PENDING
            a.applied_payment_id = None
    audit.record(
        db, principal, "FARMER_PAYMENT_STATUS_CHANGED", target=f"{payment.reference}: {old} → {new_status}",
        entity_type="farmer_payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values={"status": old}, new_values={"status": new_status, "payment_reference": reference}, reason=reason,
    )
    if new_status == PaymentStatus.FAILED:
        inbox.notify(
            db, cooperative_id=payment.cooperative_id, roles=("COOP_ADMIN",), category="PAYMENT", type="FARMER_PAYMENT_FAILED",
            severity="WARNING", title=f"Farmer payment {payment.reference} failed", body=reason,
            entity_type="farmer_payment", entity_id=payment.id, link="/cooperatives/payments",
        )
    db.commit()
    db.refresh(payment)
    return payment


def adjust_for_lines(db: Session, principal: Principal, lines: list[MilkCollection], *, source_type: str,
                     source_id: UUID, reason: str) -> list[FarmerPaymentAdjustment]:
    """Negative adjustments for lines that were already in a live payment (called when they stop counting)."""
    if not lines:
        return []
    paid = db.query(FarmerPaymentLine, FarmerPayment).join(FarmerPayment, FarmerPayment.id == FarmerPaymentLine.payment_id).filter(
        FarmerPaymentLine.collection_id.in_([l.id for l in lines]), FarmerPaymentLine.is_active.is_(True),
    ).all()
    out = []
    for line, payment in paid:
        adjustment = FarmerPaymentAdjustment(
            cooperative_id=payment.cooperative_id, farmer_id=payment.farmer_id, amount=-Decimal(str(line.amount)),
            reason=reason[:1000], source_type=source_type, source_id=source_id, collection_id=line.collection_id,
            original_payment_id=payment.id, status=AdjustmentStatus.PENDING, created_by=principal.user.id,
        )
        db.add(adjustment)
        out.append(adjustment)
    db.flush()
    return out


def payment_json(p: FarmerPayment, farmer: Optional[Farmer] = None) -> dict:
    return {
        "id": str(p.id),
        "reference": p.reference,
        "cooperative_id": str(p.cooperative_id),
        "farmer_id": str(p.farmer_id),
        "farmer_name": farmer.full_name if farmer else None,
        "farmer_number": farmer.farmer_number if farmer else None,
        "period_start": iso(p.period_start),
        "period_end": iso(p.period_end),
        "total_kg": num(p.total_kg),
        "average_price_per_kg": num(p.average_price_per_kg),
        "gross_amount": num(p.gross_amount),
        "adjustments_amount": num(p.adjustments_amount),
        "net_amount": num(p.net_amount),
        "currency": p.currency,
        "status": p.status,
        "payment_method": p.payment_method,
        "payment_account": p.payment_account,
        "payment_reference": p.payment_reference,
        "provider": p.provider,
        "failure_reason": p.failure_reason,
        "paid_at": iso(p.paid_at),
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }


def detail_json(db: Session, p: FarmerPayment) -> dict:
    farmer = db.get(Farmer, p.farmer_id)
    lines = (
        db.query(FarmerPaymentLine, MilkCollection.reference)
        .join(MilkCollection, MilkCollection.id == FarmerPaymentLine.collection_id)
        .filter(FarmerPaymentLine.payment_id == p.id).order_by(FarmerPaymentLine.collection_date).all()
    )
    adjustments = db.query(FarmerPaymentAdjustment).filter(FarmerPaymentAdjustment.applied_payment_id == p.id).all()
    return {
        **payment_json(p, farmer),
        "lines": [
            {"collection_id": str(l.collection_id), "collection_reference": ref, "collection_date": iso(l.collection_date),
             "quantity_kg": num(l.quantity_kg), "price_per_kg": num(l.price_per_kg), "amount": num(l.amount),
             "is_active": bool(l.is_active)}
            for l, ref in lines
        ],
        "adjustments": [adjustment_json(a) for a in adjustments],
    }


def adjustment_json(a: FarmerPaymentAdjustment) -> dict:
    return {
        "id": str(a.id), "farmer_id": str(a.farmer_id), "amount": num(a.amount), "reason": a.reason,
        "source_type": a.source_type, "source_id": str(a.source_id) if a.source_id else None,
        "collection_id": str(a.collection_id) if a.collection_id else None, "status": a.status,
        "applied_payment_id": str(a.applied_payment_id) if a.applied_payment_id else None, "created_at": iso(a.created_at),
    }


def initiate(db: Session, principal: Principal, payment: FarmerPayment) -> FarmerPayment:
    """Hand a PENDING/FAILED payment to the configured payout provider (PROCESSING until it confirms)."""
    from services import payouts

    provider = payouts.get_provider()
    if provider is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No payout provider is configured. Pay the farmer through M-Pesa or the bank, then record the transaction reference.",
        )
    payment = db.get(FarmerPayment, payment.id, with_for_update=True)
    if PaymentStatus.PROCESSING not in PaymentStatus.TRANSITIONS.get(payment.status, set()):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {payment.status.lower()} payment can't be sent.")
    if not payment.payment_method or not payment.payment_account:
        raise field_error("payment_account", "This farmer has no payout method on record.")
    if Decimal(str(payment.net_amount)) <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to pay: the net amount is zero or negative.")
    result = provider.initiate(
        payment_reference=payment.reference, method=payment.payment_method, account=payment.payment_account,
        amount=Decimal(str(payment.net_amount)), currency=payment.currency,
    )
    old = payment.status
    payment.provider = provider.name
    if result.accepted:
        payment.status = PaymentStatus.PROCESSING
        payment.payment_reference = result.provider_reference
    else:
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = result.error or "The payout provider refused the payment."
    audit.record(
        db, principal, "FARMER_PAYMENT_INITIATED" if result.accepted else "FARMER_PAYMENT_STATUS_CHANGED",
        target=f"{payment.reference}: {old} → {payment.status} via {provider.name}",
        entity_type="farmer_payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values={"status": old}, new_values={"status": payment.status, "provider": provider.name},
    )
    db.commit()
    db.refresh(payment)
    return payment
