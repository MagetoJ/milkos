import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import relationship

from db import Base


class Farmer(Base):
    __tablename__ = "farmers"
    # Unique within one cooperative (not across the platform). NULL national IDs never collide.
    __table_args__ = (
        Index("uq_farmers_cooperative_number", "cooperative_id", "farmer_number", unique=True),
        Index("uq_farmers_cooperative_phone", "cooperative_id", "phone", unique=True),
        Index("uq_farmers_cooperative_national_id", "cooperative_id", "national_id", unique=True),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)
    farmer_number = Column(String(50), nullable=False, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    phone = Column(String(30), nullable=False)
    national_id = Column(String(50), nullable=True)
    village = Column(String(150), nullable=True)  # farm location
    number_of_cows = Column(Integer, nullable=True)
    # How the farmer is paid for milk: MPESA (payment_account = phone) or BANK (account number + bank_name).
    payment_method = Column(String(20), nullable=True)
    payment_account = Column(String(100), nullable=True)
    bank_name = Column(String(100), nullable=True)
    status = Column(String(30), nullable=False, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    cooperative = relationship("Cooperative", back_populates="farmers", viewonly=True)
    centre = relationship("CollectionCentre", viewonly=True)
    user = relationship("User", viewonly=True)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
