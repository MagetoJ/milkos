"""Outbound notifications (cooler alerts by SMS). One row per recipient; the audit trail of every attempt."""
import datetime
import uuid

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from db import Base


class NotificationStatus:
    PENDING = "PENDING"                    # created, not yet attempted
    PENDING_PROVIDER = "PENDING_PROVIDER"  # no SMS provider is configured; kept and retried, never reported sent
    RESERVED = "RESERVED"                  # one credit reserved for this attempt (sms_credit_transactions)
    SENDING = "SENDING"                    # handed to the provider, awaiting its answer
    SENT = "SENT"                          # the SMS provider accepted it (the only "sent" state)
    FAILED = "FAILED"                      # the last attempt failed (its credit was refunded); retried while attempts remain
    REFUNDED = "REFUNDED"                  # gave up for good after its reserved credit was refunded
    SKIPPED = "SKIPPED"                    # deliberately not sent (simulated reading, receipts switched off)
    DELIVERED = "DELIVERED"                # the provider's delivery report confirmed the handset received it

    ALL = (PENDING, PENDING_PROVIDER, RESERVED, SENDING, SENT, FAILED, REFUNDED, SKIPPED, DELIVERED)
    RETRYABLE = (PENDING, PENDING_PROVIDER, FAILED)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_coop_created", "cooperative_id", "created_at"),
        Index("ix_notifications_cooler_type", "cooler_id", "type", "created_at"),
        Index("ix_notifications_status_next", "status", "next_attempt_at"),
        Index("ix_notifications_provider_message_id", "provider_message_id"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    # NULL for messages to platform accounts (no cooperative); those are billed to the platform.
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=True)
    # Who pays the credit: COOPERATIVE (its SMS credit ledger) or PLATFORM (not drawn from any ledger).
    billed_to = Column(String(20), nullable=False, default="COOPERATIVE", server_default="COOPERATIVE")
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True)
    reading_id = Column(Uuid, ForeignKey("cooler_readings.id", ondelete="SET NULL"), nullable=True)
    # Collection receipts: the allocation line (and its farmer) this SMS confirms.
    collection_id = Column(Uuid, ForeignKey("milk_collections.id", ondelete="SET NULL"), nullable=True, index=True)
    farmer_id = Column(Uuid, ForeignKey("farmers.id", ondelete="SET NULL"), nullable=True)
    # Prevents the same receipt being created twice (e.g. "receipt:<collection id>").
    idempotency_key = Column(String(120), nullable=True, unique=True)
    recipient_user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recipient_phone = Column(String(50), nullable=False)
    channel = Column(String(20), nullable=False, default="SMS")
    type = Column(String(40), nullable=False)       # LOW_VOLUME, HIGH_VOLUME, STALE_READING, ...
    severity = Column(String(20), nullable=False)   # INFO / WARNING / CRITICAL
    message = Column(Text, nullable=False)
    context = Column(JSON().with_variant(JSONB(), "postgresql"))  # cooler, location, manager, reading, threshold
    status = Column(String(20), nullable=False, default=NotificationStatus.PENDING)
    provider = Column(String(50))
    provider_message_id = Column(String(255))
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at = Column(DateTime)
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    sent_at = Column(DateTime)
    delivered_at = Column(DateTime)
    failed_at = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
