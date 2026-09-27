from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, func, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CooperativeStatus(str, Enum):
    PENDING = "PENDING"
    UNDER_REVIEW = "UNDER_REVIEW"
    MORE_INFORMATION_REQUIRED = "MORE_INFORMATION_REQUIRED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


# Application states in which a review decision is still outstanding.
OPEN_APPLICATION_STATUSES = (
    CooperativeStatus.PENDING,
    CooperativeStatus.UNDER_REVIEW,
    CooperativeStatus.MORE_INFORMATION_REQUIRED,
)


class Cooperative(Base):
    """A tenant. Every tenant-owned row references a cooperative ID."""

    __tablename__ = "cooperatives"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Case/whitespace-folded name. Unique so concurrent duplicate
    # registrations are rejected by the database, not only by a pre-check.
    name_normalized: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    registration_number: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    status: Mapped[CooperativeStatus] = mapped_column(
        SAEnum(CooperativeStatus, name="CooperativeStatus", create_type=False),
        nullable=False,
        default=CooperativeStatus.PENDING,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="KES")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    memberships = relationship("Membership", back_populates="cooperative")
    application = relationship(
        "CooperativeApplication", back_populates="cooperative", uselist=False
    )


class CooperativeApplication(Base):
    __tablename__ = "cooperative_applications"
    __table_args__ = (
        # An applicant may have at most one application awaiting a decision.
        Index(
            "uq_cooperative_applications_open_per_applicant",
            "applicant_user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('PENDING', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED')"
            ),
        ),
        Index("ix_cooperative_applications_status_submitted", "status", "submitted_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    cooperative_id: Mapped[UUID] = mapped_column(
        ForeignKey("cooperatives.id"), nullable=False, unique=True
    )
    applicant_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[CooperativeStatus] = mapped_column(
        SAEnum(CooperativeStatus, name="CooperativeStatus", create_type=False),
        nullable=False,
        default=CooperativeStatus.PENDING,
    )
    reference: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    contact_phone: Mapped[str] = mapped_column(String, nullable=False)
    contact_email: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    requested_information: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    cooperative = relationship("Cooperative", back_populates="application")
