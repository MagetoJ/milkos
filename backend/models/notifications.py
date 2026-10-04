"""Outbound notifications (cooler alerts by SMS). One row per recipient; the audit trail of every attempt."""
import datetime
import uuid

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from db import Base


class NotificationStatus:
    PENDING = "PENDING"  # created, not yet handed to the provider
    SENT = "SENT"        # the SMS provider accepted it
    FAILED = "FAILED"    # provider refused / unreachable / no credits; retried while attempts remain
    SKIPPED = "SKIPPED"  # deliberately not sent (simulated reading, alerts switched off)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_coop_created", "cooperative_id", "created_at"),
        Index("ix_notifications_cooler_type", "cooler_id", "type", "created_at"),
        Index("ix_notifications_status_next", "status", "next_attempt_at"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True)
    reading_id = Column(Uuid, ForeignKey("cooler_readings.id", ondelete="SET NULL"), nullable=True)
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
    failed_at = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
