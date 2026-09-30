import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint, Uuid

from db import Base


class CooperativeMembership(Base):
    __tablename__ = "cooperative_memberships"
    __table_args__ = (
        UniqueConstraint("cooperative_id", "user_id", name="uq_cooperative_user"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False)
    status = Column(String(30), nullable=False, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
