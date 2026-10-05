"""SMS credit ledger: the authoritative record of every credit a cooperative bought, used or got back.

Balances are SUMS over sms_credit_transactions, never a counter someone can overwrite. Every entry is
appended in the same transaction as the business event that caused it (a verified payment, an SMS
attempt, an admin adjustment), and (cooperative, type, reference) is unique, so a retried event can't be
counted twice. cooperatives.sms_credit_balance is kept only as a cache of the available balance (sorting,
older screens); it is recomputed from the ledger on every entry.

    available = PURCHASE + ADJUSTMENT + REFUNDED - RESERVED - EXPIRY
    reserved  = RESERVED - CONSUMED - REFUNDED     (held by attempts still in flight)
"""
import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.utils import iso
from models.cooperative import Cooperative
from models.finance import CreditTxn, SmsCreditTransaction


def balances(db: Session, cooperative_id: UUID) -> dict:
    t, a = SmsCreditTransaction.transaction_type, SmsCreditTransaction.amount

    def total(kind: str):
        return func.coalesce(func.sum(case((t == kind, a), else_=0)), 0)

    row = db.query(*(total(kind) for kind in CreditTxn.ALL)).filter(
        SmsCreditTransaction.cooperative_id == cooperative_id
    ).one()
    sums = dict(zip(CreditTxn.ALL, (int(v or 0) for v in row)))
    reserved_total = -sums[CreditTxn.RESERVED]
    consumed = -sums[CreditTxn.CONSUMED]
    refunded = sums[CreditTxn.REFUNDED]
    available = sum(sums[k] for k in CreditTxn.AFFECTS_AVAILABLE)
    return {
        "available": available,
        "reserved": reserved_total - consumed - refunded,
        "consumed": consumed,
        "refunded": refunded,
        "purchased": sums[CreditTxn.PURCHASE],
        "adjusted": sums[CreditTxn.ADJUSTMENT],
        "expired": -sums[CreditTxn.EXPIRY],
        # What the cooperative holds, including credits held for messages in flight.
        "balance": available + (reserved_total - consumed - refunded),
    }


def available(db: Session, cooperative_id: UUID) -> int:
    return balances(db, cooperative_id)["available"]


def _lock(db: Session, cooperative_id: UUID) -> Cooperative:
    """Serialise ledger writes per cooperative (row lock on Postgres; SQLite serialises writers anyway)."""
    coop = db.get(Cooperative, cooperative_id, with_for_update=True)
    if coop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooperative not found")
    return coop


def _refresh_cache(db: Session, coop: Cooperative) -> None:
    db.flush()
    value = available(db, coop.id)
    if coop.sms_credit_balance != value:
        coop.sms_credit_balance = value  # the sync change log picks this up on flush (devices show the balance)


def _exists(db: Session, cooperative_id: UUID, kind: str, reference: str) -> Optional[SmsCreditTransaction]:
    return db.query(SmsCreditTransaction).filter(
        SmsCreditTransaction.cooperative_id == cooperative_id, SmsCreditTransaction.transaction_type == kind,
        SmsCreditTransaction.reference == reference,
    ).first()


def _append(db: Session, coop: Cooperative, kind: str, amount: int, reference: str, *, reason: Optional[str] = None,
            actor_user_id: Optional[UUID] = None, details: Optional[dict] = None) -> SmsCreditTransaction:
    entry = SmsCreditTransaction(
        cooperative_id=coop.id, transaction_type=kind, amount=amount, reference=reference[:120], reason=reason,
        actor_user_id=actor_user_id, details=details, created_at=datetime.datetime.utcnow(),
    )
    db.add(entry)
    _refresh_cache(db, coop)
    return entry


def purchase(db: Session, cooperative_id: UUID, credits: int, payment_id: UUID, actor_user_id: UUID,
             details: Optional[dict] = None) -> SmsCreditTransaction:
    """Credit a VERIFIED payment (once per payment)."""
    coop = _lock(db, cooperative_id)
    reference = f"payment:{payment_id}"
    existing = _exists(db, coop.id, CreditTxn.PURCHASE, reference)
    if existing is not None:
        return existing
    if credits <= 0:
        raise HTTPException(422, "A purchase must add at least one credit.")
    return _append(db, coop, CreditTxn.PURCHASE, credits, reference, reason="Verified SMS credit payment",
                   actor_user_id=actor_user_id, details=details)


def adjust(db: Session, cooperative_id: UUID, delta: int, reason: str, actor_user_id: UUID, reference: str) -> tuple[int, int]:
    """Platform adjustment (bonus or correction). Returns (available before, available after)."""
    coop = _lock(db, cooperative_id)
    before = available(db, coop.id)
    if delta == 0:
        raise HTTPException(422, "Enter a non-zero number of credits.")
    if before + delta < 0:
        raise HTTPException(422, f"The balance is {before:,} credits; you can remove at most that many.")
    _append(db, coop, CreditTxn.ADJUSTMENT, delta, reference, reason=reason, actor_user_id=actor_user_id)
    return before, before + delta


def reserve(db: Session, cooperative_id: UUID, reference: str, credits: int = 1) -> bool:
    """Hold credits for one send attempt. False when the available balance is too low (nothing is written)."""
    coop = _lock(db, cooperative_id)
    if _exists(db, coop.id, CreditTxn.RESERVED, reference) is not None:
        return True  # already held for this very attempt
    if available(db, coop.id) < credits:
        return False
    _append(db, coop, CreditTxn.RESERVED, -credits, reference, reason="Held for an SMS send attempt")
    return True


def _settle(db: Session, cooperative_id: UUID, reference: str, kind: str, reason: str) -> bool:
    coop = _lock(db, cooperative_id)
    held = _exists(db, coop.id, CreditTxn.RESERVED, reference)
    if held is None:
        return False
    settled = db.query(SmsCreditTransaction.id).filter(
        SmsCreditTransaction.cooperative_id == coop.id, SmsCreditTransaction.reference == reference,
        SmsCreditTransaction.transaction_type.in_((CreditTxn.CONSUMED, CreditTxn.REFUNDED)),
    ).first()
    if settled is not None:
        return False  # a reservation is consumed or refunded exactly once
    amount = -held.amount  # positive number of credits held
    _append(db, coop, kind, -amount if kind == CreditTxn.CONSUMED else amount, reference, reason=reason)
    return True


def next_reference(db: Session, cooperative_id: UUID, prefix: str) -> str:
    """A reservation reference never used before for `prefix` (one per attempt, even after a manual retry)."""
    used = db.query(func.count(SmsCreditTransaction.id)).filter(
        SmsCreditTransaction.cooperative_id == cooperative_id,
        SmsCreditTransaction.transaction_type == CreditTxn.RESERVED,
        SmsCreditTransaction.reference.like(f"{prefix}%"),
    ).scalar() or 0
    return f"{prefix}{used + 1}"


def open_reservations(db: Session, cooperative_id: UUID, prefix: str) -> list[str]:
    """References under `prefix` that were reserved and never consumed or refunded."""
    rows = db.query(SmsCreditTransaction.reference, SmsCreditTransaction.transaction_type).filter(
        SmsCreditTransaction.cooperative_id == cooperative_id, SmsCreditTransaction.reference.like(f"{prefix}%"),
    ).all()
    held = {ref for ref, kind in rows if kind == CreditTxn.RESERVED}
    settled = {ref for ref, kind in rows if kind in (CreditTxn.CONSUMED, CreditTxn.REFUNDED)}
    return sorted(held - settled)


def consume(db: Session, cooperative_id: UUID, reference: str) -> bool:
    return _settle(db, cooperative_id, reference, CreditTxn.CONSUMED, "SMS accepted by the provider")


def refund(db: Session, cooperative_id: UUID, reference: str, reason: str = "SMS attempt failed") -> bool:
    return _settle(db, cooperative_id, reference, CreditTxn.REFUNDED, reason)


def transaction_json(t: SmsCreditTransaction, actor_email: Optional[str] = None) -> dict:
    return {
        "id": str(t.id),
        "cooperative_id": str(t.cooperative_id),
        "transaction_type": t.transaction_type,
        "amount": t.amount,
        "reference": t.reference,
        "reason": t.reason,
        "actor_user_id": str(t.actor_user_id) if t.actor_user_id else None,
        "actor_email": actor_email,
        "metadata": t.details,
        "created_at": iso(t.created_at),
    }
