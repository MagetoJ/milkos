"""Money and credits: the SMS credit ledger, milk prices and farmer payments.

Every table here is append-mostly. Balances are derived from ledger rows; prices are never edited (a new
price closes the previous one's open end date); payment records change status but their lines and amounts
are fixed once generated. Corrections to paid milk become adjustments carried into the next payment.
"""
import datetime
import uuid

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, Uuid,
    text, true,
)
from sqlalchemy.dialects.postgresql import JSONB

from db import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


# ---------------- SMS credit ledger ----------------

class CreditTxn:
    """Ledger entry types. `amount` is signed: its effect on the AVAILABLE balance, except CONSUMED.

        PURCHASE    +n  verified SMS credit payment
        ADJUSTMENT  +/- platform adjustment (bonus, correction, opening balance)
        RESERVED    -n  held for one SMS send attempt
        CONSUMED    -n  the provider accepted the SMS: the reservation is spent (no further effect on available)
        REFUNDED    +n  the attempt failed: the reservation is returned
        EXPIRY      -n  expired credits (not used unless credits are given an expiry)
    """
    PURCHASE = "PURCHASE"
    ADJUSTMENT = "ADJUSTMENT"
    RESERVED = "RESERVED"
    CONSUMED = "CONSUMED"
    REFUNDED = "REFUNDED"
    EXPIRY = "EXPIRY"

    ALL = (PURCHASE, ADJUSTMENT, RESERVED, CONSUMED, REFUNDED, EXPIRY)
    AFFECTS_AVAILABLE = (PURCHASE, ADJUSTMENT, RESERVED, REFUNDED, EXPIRY)


class SmsCreditTransaction(Base):
    __tablename__ = "sms_credit_transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_sms_credit_transactions_nonzero"),
        # Idempotency: one entry of each type per reference (a payment is credited once, an attempt is
        # reserved / consumed / refunded once).
        Index("uq_sms_credit_txn_coop_type_ref", "cooperative_id", "transaction_type", "reference", unique=True),
        Index("ix_sms_credit_txn_coop_created", "cooperative_id", "created_at"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    transaction_type = Column(String(20), nullable=False)
    amount = Column(Integer, nullable=False)
    reference = Column(String(120), nullable=False)
    reason = Column(Text)
    actor_user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # `metadata` is reserved by SQLAlchemy's declarative base, so the attribute is `details`.
    details = Column("metadata", JSON_TYPE)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)


# ---------------- milk pricing ----------------

class PriceStatus:
    ACTIVE = "ACTIVE"
    CANCELLED = "CANCELLED"  # withdrawn before any payment used it


class MilkPrice(Base):
    """Price per KG paid to farmers by one cooperative, valid from effective_from to effective_to (inclusive;
    NULL = open-ended). The applicable price for a collection is the ACTIVE price whose window contains its date."""
    __tablename__ = "milk_prices"
    __table_args__ = (
        CheckConstraint("price_per_kg > 0", name="ck_milk_prices_positive"),
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_milk_prices_window"),
        Index("ix_milk_prices_coop_from", "cooperative_id", "effective_from"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    price_per_kg = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="KES", server_default=text("'KES'"))
    status = Column(String(20), nullable=False, default=PriceStatus.ACTIVE, server_default=text("'ACTIVE'"))
    notes = Column(Text)
    created_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    cancelled_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    cancelled_at = Column(DateTime)
    cancel_reason = Column(Text)


# ---------------- farmer payments ----------------

class PaymentStatus:
    PENDING = "PENDING"        # calculated, not yet paid
    PROCESSING = "PROCESSING"  # handed to a payout provider / bank, awaiting confirmation
    PAID = "PAID"              # confirmed paid (provider confirmation or a recorded transaction reference)
    FAILED = "FAILED"          # the payout failed; can be retried or cancelled
    CANCELLED = "CANCELLED"    # withdrawn; its milk becomes payable again

    TRANSITIONS = {
        PENDING: {PROCESSING, PAID, CANCELLED},
        PROCESSING: {PAID, FAILED},
        FAILED: {PROCESSING, PAID, CANCELLED},
        PAID: set(),
        CANCELLED: set(),
    }
    OPEN = (PENDING, PROCESSING, FAILED)


class FarmerPayment(Base):
    __tablename__ = "farmer_payments"
    __table_args__ = (
        CheckConstraint("period_end >= period_start", name="ck_farmer_payments_period"),
        Index("ix_farmer_payments_coop_period", "cooperative_id", "period_start", "period_end"),
        Index("ix_farmer_payments_farmer", "farmer_id", "period_start"),
        Index("ix_farmer_payments_coop_status", "cooperative_id", "status"),
        Index(
            "uq_farmer_payments_farmer_period_open", "farmer_id", "period_start", "period_end", unique=True,
            postgresql_where=text("status <> 'CANCELLED'"), sqlite_where=text("status <> 'CANCELLED'"),
        ),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    reference = Column(String(40), nullable=False, unique=True)  # FP-2610-4F2A9C
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    farmer_id = Column(Uuid, ForeignKey("farmers.id", ondelete="RESTRICT"), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    total_kg = Column(Numeric(12, 2), nullable=False)
    average_price_per_kg = Column(Numeric(10, 4))
    gross_amount = Column(Numeric(14, 2), nullable=False)
    adjustments_amount = Column(Numeric(14, 2), nullable=False, default=0, server_default=text("0"))
    net_amount = Column(Numeric(14, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="KES", server_default=text("'KES'"))
    status = Column(String(20), nullable=False, default=PaymentStatus.PENDING, server_default=text("'PENDING'"))
    payment_method = Column(String(20))       # snapshot of the farmer's payout method at generation time
    payment_account = Column(String(100))
    payment_reference = Column(String(100))   # transaction reference from the provider / bank
    provider = Column(String(50))
    failure_reason = Column(Text)
    paid_at = Column(DateTime)
    created_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class FarmerPaymentLine(Base):
    """One allocation line paid by a payment, with the price used (the pricing context is kept forever)."""
    __tablename__ = "farmer_payment_lines"
    __table_args__ = (
        Index("ix_farmer_payment_lines_payment", "payment_id"),
        # A collection is in at most one live payment; lines of a cancelled payment are released.
        Index(
            "uq_farmer_payment_lines_collection_active", "collection_id", unique=True,
            postgresql_where=text("is_active"), sqlite_where=text("is_active = 1"),
        ),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    payment_id = Column(Uuid, ForeignKey("farmer_payments.id", ondelete="CASCADE"), nullable=False)
    collection_id = Column(Uuid, ForeignKey("milk_collections.id", ondelete="RESTRICT"), nullable=False)
    collection_date = Column(Date, nullable=False)
    quantity_kg = Column(Numeric(10, 2), nullable=False)
    price_id = Column(Uuid, ForeignKey("milk_prices.id", ondelete="RESTRICT"), nullable=False)
    price_per_kg = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default=true())


class AdjustmentStatus:
    PENDING = "PENDING"      # waiting to be included in the farmer's next payment
    APPLIED = "APPLIED"      # included in applied_payment_id
    CANCELLED = "CANCELLED"


class FarmerPaymentAdjustment(Base):
    """A signed amount owed to (+) or recovered from (-) a farmer, e.g. milk that was paid and later
    corrected or reversed. Applied to the farmer's next generated payment."""
    __tablename__ = "farmer_payment_adjustments"
    __table_args__ = (
        Index("ix_farmer_payment_adjustments_farmer_status", "farmer_id", "status"),
        Index("ix_farmer_payment_adjustments_coop", "cooperative_id", "created_at"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    farmer_id = Column(Uuid, ForeignKey("farmers.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    reason = Column(Text, nullable=False)
    source_type = Column(String(30), nullable=False)  # CORRECTION / REVERSAL
    source_id = Column(Uuid, nullable=True)            # the correction request
    collection_id = Column(Uuid, ForeignKey("milk_collections.id", ondelete="SET NULL"), nullable=True)
    original_payment_id = Column(Uuid, ForeignKey("farmer_payments.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default=AdjustmentStatus.PENDING, server_default=text("'PENDING'"))
    applied_payment_id = Column(Uuid, ForeignKey("farmer_payments.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
