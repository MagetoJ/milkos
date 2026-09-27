from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VerificationChannel(str, Enum):
    PHONE = "PHONE"
    EMAIL = "EMAIL"


class VerificationStatus(str, Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    EXPIRED = "EXPIRED"
    LOCKED = "LOCKED"
    # Used by exactly one application; cannot be replayed.
    CONSUMED = "CONSUMED"


class RegistrationVerification(Base):
    """A contact OTP challenge, bound to the authenticated user who started it."""

    __tablename__ = "registration_verifications"
    __table_args__ = (
        Index("ix_registration_verifications_user_created", "user_id", "created_at"),
        Index(
            "ix_registration_verifications_destination_created", "destination", "created_at"
        ),
        Index("ix_registration_verifications_ip_created", "ip_address", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    channel: Mapped[VerificationChannel] = mapped_column(
        SAEnum(VerificationChannel, name="VerificationChannel", create_type=False),
        nullable=False,
    )
    destination: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[VerificationStatus] = mapped_column(
        SAEnum(VerificationStatus, name="VerificationStatus", create_type=False),
        nullable=False,
        default=VerificationStatus.PENDING,
    )
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
