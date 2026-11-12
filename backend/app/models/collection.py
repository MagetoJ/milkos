import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Numeric, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from app.db.base_class import Base

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
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )