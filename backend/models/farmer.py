import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Uuid

from db import Base


class Farmer(Base):
    __tablename__ = "farmers"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)
    farmer_number = Column(String(50), nullable=False, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    phone = Column(String(30), nullable=False)
    national_id = Column(String(50), nullable=True)
    village = Column(String(150), nullable=True)
    status = Column(String(30), nullable=False, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
