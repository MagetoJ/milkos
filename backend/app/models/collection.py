import uuid
from datetime import UTC, datetime

from app.db.base_class import Base
from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID


class MilkCollection(Base):
    __tablename__ = "milk_collections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Idempotency key generated offline by Dexie.js
    client_tx_id = Column(UUID(as_uuid=True), unique=True, index=True, nullable=False)
    
    cooperative_id = Column(UUID(as_uuid=True), ForeignKey("cooperatives.id"), nullable=False, index=True)
    farmer_id = Column(UUID(as_uuid=True), ForeignKey("farmers.id"), nullable=False, index=True)
    collector_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    weight_kg = Column(Numeric(10, 2), nullable=False)
    grade = Column(String(2), nullable=False, default="A")
    shift = Column(String(16), nullable=False, default="MORNING")
    
    collected_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )