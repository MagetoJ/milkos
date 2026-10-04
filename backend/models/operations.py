"""Field operations: collector profiles and milk collections."""
import datetime
import uuid

from sqlalchemy import (
    Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, Time, Uuid, text,
)
from sqlalchemy.orm import relationship

from db import Base


class Collector(Base):
    """Operational profile of a COLLECTOR user: number, area and the cooler/centre they deliver to.

    The person's name, phone and login live on the linked User; they are not copied here.
    """
    __tablename__ = "collectors"
    __table_args__ = (
        Index("uq_collectors_cooperative_number", "cooperative_id", "collector_number", unique=True),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    collector_number = Column(String(50), nullable=False)
    assigned_area = Column(String(255))
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="ACTIVE", server_default=text("'ACTIVE'"))
    sync_version = Column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    user = relationship("User", viewonly=True)
    cooperative = relationship("Cooperative", back_populates="collectors", viewonly=True)
    centre = relationship("CollectionCentre", viewonly=True)
    cooler = relationship("Cooler", viewonly=True)


class QualityStatus:
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    PENDING = "PENDING"  # awaiting a lab result

    ALL = (ACCEPTED, REJECTED, PENDING)


class MilkCollection(Base):
    __tablename__ = "milk_collections"
    __table_args__ = (
        Index("ix_milk_collections_coop_date", "cooperative_id", "collection_date"),
        Index("ix_milk_collections_farmer", "farmer_id", "collection_date"),
        Index("ix_milk_collections_collector", "collector_id"),
        Index("ix_milk_collections_cooler", "cooler_id"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    reference = Column(String(40), nullable=False, unique=True)  # e.g. MC-261003-4F2A9C
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    # RESTRICT: a farmer with milk records can be deactivated but not deleted.
    farmer_id = Column(Uuid, ForeignKey("farmers.id", ondelete="RESTRICT"), nullable=False)
    collector_id = Column(Uuid, ForeignKey("collectors.id", ondelete="SET NULL"), nullable=True)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True)
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True)
    collection_date = Column(Date, nullable=False)
    collection_time = Column(Time, nullable=False)
    quantity_litres = Column(Numeric(10, 2), nullable=False)
    fat_percentage = Column(Numeric(5, 2))
    snf_percentage = Column(Numeric(5, 2))
    temperature_c = Column(Numeric(5, 2))
    quality_status = Column(String(20), nullable=False, default=QualityStatus.ACCEPTED, server_default=text("'ACCEPTED'"))
    rejection_reason = Column(Text)
    notes = Column(Text)
    recorded_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Offline capture: the device that recorded it and the device's own clock at that moment (metadata
    # only; created_at/updated_at are always server time).
    device_id = Column(Uuid, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    client_recorded_at = Column(DateTime, nullable=True)
    sync_version = Column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    cooperative = relationship("Cooperative", back_populates="collections", viewonly=True)
    farmer = relationship("Farmer", viewonly=True)
    collector = relationship("Collector", viewonly=True)
    cooler = relationship("Cooler", viewonly=True)
    centre = relationship("CollectionCentre", viewonly=True)
