"""In-app notification center (distinct from `notifications`, which records outbound SMS deliveries).

A row is addressed either to one user (recipient_user_id) or to roles within a cooperative
(audience_roles, comma-separated). Rows with cooperative_id NULL are platform events, visible to
platform staff only. Read state is per user in inbox_reads.
"""
import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, Uuid

from db import Base


class InboxNotification(Base):
    __tablename__ = "inbox_notifications"
    __table_args__ = (
        Index("ix_inbox_coop_created", "cooperative_id", "created_at"),
        Index("ix_inbox_recipient_created", "recipient_user_id", "created_at"),
        Index("ix_inbox_entity", "entity_type", "entity_id", "type"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=True)
    recipient_user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    audience_roles = Column(String(120))  # e.g. "COOP_ADMIN,MANAGER"; NULL with a recipient = that user only
    category = Column(String(30), nullable=False)  # COOLER, SMS, COLLECTION, PAYMENT, SYNC, SYSTEM
    type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False, default="INFO")  # INFO / WARNING / CRITICAL
    title = Column(String(200), nullable=False)
    body = Column(Text)
    entity_type = Column(String(50))
    entity_id = Column(String(64))
    link = Column(String(300))
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)


class InboxRead(Base):
    __tablename__ = "inbox_reads"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", name="uq_inbox_reads_notification_user"),)

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    notification_id = Column(Uuid, ForeignKey("inbox_notifications.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    read_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
