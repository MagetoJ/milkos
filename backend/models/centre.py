import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, Uuid

from db import Base


class CollectionCentre(Base):
    __tablename__ = "collection_centres"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(50), nullable=False, index=True)
    county = Column(String(100), nullable=False)
    location_description = Column(Text, nullable=True)
    manager_user_id = Column(Uuid, nullable=True)
    has_cooler = Column(Boolean, nullable=False, default=False)
    cooler_capacity_litres = Column(nullable=True)
    status = Column(String(30), nullable=False, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
