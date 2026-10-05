"""Field operations: collector profiles, collection batches and their per-farmer allocation lines.

A collection batch is one weighing: a collector puts milk on a scale at a centre/cooler, captures the weight
in KG, then allocates that weight to one or more farmers. Each allocation line is a MilkCollection row (the
per-farmer record every report, receipt and payment already works with).

Confirmed batches are never edited in place. A correction creates a new batch that supersedes the original
(the original and its lines stay, marked CORRECTED / SUPERSEDED); a reversal marks the batch REVERSED.
Both go through CollectionCorrectionRequest (maker-checker).
"""
import datetime
import uuid

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, Time, Uuid,
    text, true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from db import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


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


class BatchStatus:
    """Server-side lifecycle of a collection batch. Drafts, capture and allocation happen on the device."""
    CONFIRMED = "CONFIRMED"
    CORRECTION_PENDING = "CORRECTION_PENDING"  # a correction request awaits review; data unchanged
    REVERSAL_PENDING = "REVERSAL_PENDING"      # a reversal request awaits review; data unchanged
    CORRECTED = "CORRECTED"                    # superseded by the batch in superseded_by_batch_id
    REVERSED = "REVERSED"                      # voided; kept for history, excluded from totals and payments

    ALL = (CONFIRMED, CORRECTION_PENDING, REVERSAL_PENDING, CORRECTED, REVERSED)
    EFFECTIVE = (CONFIRMED, CORRECTION_PENDING, REVERSAL_PENDING)  # still counts in totals and payments
    TRANSITIONS = {
        CONFIRMED: {CORRECTION_PENDING, REVERSAL_PENDING},
        CORRECTION_PENDING: {CONFIRMED, CORRECTED},
        REVERSAL_PENDING: {CONFIRMED, REVERSED},
        CORRECTED: set(),
        REVERSED: set(),
    }


class WeightSource:
    SCALE = "SCALE"            # read from a connected scale through a ScaleAdapter
    MANUAL = "MANUAL"          # typed in by the collector (never presented as a scale reading)
    SIMULATED = "SIMULATED"    # development scale simulator; never a real measurement
    LITRES = "LITRES"          # entered in litres (legacy single-farmer records); KG derived with the density

    CAPTURE = (SCALE, MANUAL, SIMULATED)
    ALL = (SCALE, MANUAL, SIMULATED, LITRES)


class LineStatus:
    """Status of an allocation line (MilkCollection), mirroring its batch."""
    ACTIVE = "ACTIVE"
    SUPERSEDED = "SUPERSEDED"  # the batch was corrected; the replacement batch has the current lines
    REVERSED = "REVERSED"


class CollectionBatch(Base):
    __tablename__ = "collection_batches"
    __table_args__ = (
        CheckConstraint("captured_weight_kg > 0", name="ck_collection_batches_captured_positive"),
        CheckConstraint("allocated_weight_kg > 0", name="ck_collection_batches_allocated_positive"),
        CheckConstraint("allocated_weight_kg <= captured_weight_kg", name="ck_collection_batches_not_over_allocated"),
        Index("ix_collection_batches_coop_date", "cooperative_id", "collection_date"),
        Index("ix_collection_batches_collector", "collector_id", "collection_date"),
        Index("ix_collection_batches_cooler", "cooler_id"),
        Index("ix_collection_batches_centre", "centre_id"),
        Index("ix_collection_batches_coop_status", "cooperative_id", "status"),
        Index("ix_collection_batches_device", "device_id"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    reference = Column(String(40), nullable=False, unique=True)  # e.g. CB-261004-4F2A9C
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True)
    cooler_id = Column(Uuid, ForeignKey("coolers.id", ondelete="SET NULL"), nullable=True)
    collector_id = Column(Uuid, ForeignKey("collectors.id", ondelete="SET NULL"), nullable=True)
    recorded_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    device_id = Column(Uuid, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(30), nullable=False, default=BatchStatus.CONFIRMED, server_default=text("'CONFIRMED'"))
    collection_date = Column(Date, nullable=False)
    collection_time = Column(Time, nullable=False)
    # Weight. captured = what the scale (or person) measured; allocated = sum of the lines (<= captured).
    captured_weight_kg = Column(Numeric(10, 2), nullable=False)
    allocated_weight_kg = Column(Numeric(10, 2), nullable=False)
    tare_weight_kg = Column(Numeric(10, 2), nullable=True)
    weight_source = Column(String(20), nullable=False)
    scale_name = Column(String(255))
    scale_identifier = Column(String(255))  # the adapter's device id (no hardware protocol is implied)
    # KG per litre used for this batch's litre figures; stored so later setting changes never alter history.
    density_kg_per_litre = Column(Numeric(6, 4), nullable=False)
    temperature_c = Column(Numeric(5, 2))
    notes = Column(Text)
    # Device clock (metadata only): when the collector started, captured the weight and confirmed.
    started_at = Column(DateTime)
    captured_at = Column(DateTime)
    confirmed_at = Column(DateTime)
    client_recorded_at = Column(DateTime)
    send_receipts = Column(Boolean, nullable=False, default=True, server_default=true())  # SMS receipts to farmers
    supersedes_batch_id = Column(Uuid, ForeignKey("collection_batches.id", ondelete="SET NULL"), nullable=True)
    superseded_by_batch_id = Column(Uuid, ForeignKey("collection_batches.id", ondelete="SET NULL"), nullable=True)
    sync_version = Column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    lines = relationship("MilkCollection", viewonly=True, order_by="MilkCollection.reference")

    @property
    def remaining_weight_kg(self):
        return self.captured_weight_kg - self.allocated_weight_kg


class MilkCollection(Base):
    """One farmer's share of a collection batch (an allocation line)."""
    __tablename__ = "milk_collections"
    __table_args__ = (
        Index("ix_milk_collections_coop_date", "cooperative_id", "collection_date"),
        Index("ix_milk_collections_farmer", "farmer_id", "collection_date"),
        Index("ix_milk_collections_collector", "collector_id"),
        Index("ix_milk_collections_cooler", "cooler_id"),
        Index("ix_milk_collections_centre", "centre_id"),
        Index("ix_milk_collections_batch", "batch_id"),
        Index("ix_milk_collections_device", "device_id"),
        # One allocation line per farmer per batch.
        Index("uq_milk_collections_batch_farmer", "batch_id", "farmer_id", unique=True),
        CheckConstraint("quantity_kg > 0", name="ck_milk_collections_kg_positive"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    reference = Column(String(40), nullable=False, unique=True)  # e.g. MC-261003-4F2A9C
    batch_id = Column(Uuid, ForeignKey("collection_batches.id", ondelete="CASCADE"), nullable=False)
    quantity_kg = Column(Numeric(10, 2), nullable=False)
    record_status = Column(String(20), nullable=False, default=LineStatus.ACTIVE, server_default=text("'ACTIVE'"))
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
    batch = relationship("CollectionBatch", viewonly=True)


class RequestType:
    CORRECTION = "CORRECTION"
    REVERSAL = "REVERSAL"


class RequestStatus:
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class CollectionCorrectionRequest(Base):
    """A request to correct or reverse a confirmed batch (maker-checker: the requester can't approve it).

    original_values is the batch as it was when the request was made; proposed_values is the complete
    replacement for a CORRECTION (same shape) and empty for a REVERSAL. Approving a correction creates a
    new batch (resulting_batch_id) and leaves the original untouched apart from its status.
    """
    __tablename__ = "collection_correction_requests"
    __table_args__ = (
        Index("ix_correction_requests_coop_status", "cooperative_id", "status", "created_at"),
        Index("ix_correction_requests_batch", "batch_id"),
        # At most one open request per batch.
        Index(
            "uq_correction_requests_batch_pending", "batch_id", unique=True,
            postgresql_where=text("status = 'PENDING'"), sqlite_where=text("status = 'PENDING'"),
        ),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False)
    batch_id = Column(Uuid, ForeignKey("collection_batches.id", ondelete="CASCADE"), nullable=False)
    request_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default=RequestStatus.PENDING, server_default=text("'PENDING'"))
    reason = Column(Text, nullable=False)
    original_values = Column(JSON_TYPE, nullable=False)
    proposed_values = Column(JSON_TYPE)
    requested_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    requested_role = Column(String(30))
    reviewed_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime)
    review_comment = Column(Text)
    resulting_batch_id = Column(Uuid, ForeignKey("collection_batches.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
