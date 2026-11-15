import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Uuid

from app.infrastructure.db.database import Base


class NativeOAuthTransaction(Base):
    __tablename__ = "native_oauth_transactions"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)

    state_hash = Column(String(64), nullable=False, unique=True)
    pkce_verifier_encrypted = Column(String(512), nullable=False)

    ticket_hash = Column(String(64), nullable=True, unique=True)

    user_id = Column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.datetime.utcnow,
    )

    expires_at = Column(DateTime, nullable=False)
    state_used_at = Column(DateTime, nullable=True)
    ticket_used_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_native_oauth_expires_at", "expires_at"),
        Index("ix_native_oauth_user_id", "user_id"),
    )
