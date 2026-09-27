from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MembershipRole(str, Enum):
    COOPERATIVE_MANAGER = "COOPERATIVE_MANAGER"
    COLLECTOR = "COLLECTOR"
    FARMER = "FARMER"


class MembershipStatus(str, Enum):
    INVITED = "INVITED"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    REVOKED = "REVOKED"


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "cooperative_id", "role", name="uq_memberships_user_coop_role"),
        Index("ix_memberships_cooperative_status", "cooperative_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    cooperative_id: Mapped[UUID] = mapped_column(ForeignKey("cooperatives.id"), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(SAEnum(MembershipRole, name="MembershipRole", create_type=False), nullable=False)
    status: Mapped[MembershipStatus] = mapped_column(
        SAEnum(MembershipStatus, name="MembershipStatus", create_type=False),
        nullable=False,
        default=MembershipStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="memberships")
    cooperative = relationship("Cooperative", back_populates="memberships")
