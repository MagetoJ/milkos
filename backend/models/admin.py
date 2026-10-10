from sqlalchemy import (
    JSON, Column, String, Numeric, Boolean, DateTime, ForeignKey, Index, Integer, Text, Uuid, text, true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
import uuid
import datetime

from db import Base

class CooperativeApplication(Base):
    __tablename__ = "cooperative_applications"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    org_name = Column(String(255), nullable=False)
    applicant_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=False)
    location = Column(String(255), nullable=False)  # display form: "<sub-county>, <county>"
    status = Column(String(50), default="PENDING")

    registration_number = Column(String(50))
    kra_pin = Column(String(11))
    county = Column(String(50))
    sub_county = Column(String(255))
    admin_id_number = Column(String(20))
    estimated_daily_liters = Column(Numeric(12, 2))
    initial_coolers_count = Column(Integer)
    additional_info = Column("notes", Text)  # stored in the pre-existing `notes` column

    admin_user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="SET NULL"))
    rejection_reason = Column(Text)
    reviewed_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at = Column(DateTime)
    # Issues detected at registration, for the superadmin: [{"code", "message"}, ...]
    flags = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    __table_args__ = (
        # Only one application per registration number / KRA PIN can be awaiting review.
        # The database enforces this, so two simultaneous submissions can't both get in.
        Index(
            "uq_coop_applications_pending_registration_number", "registration_number", unique=True,
            postgresql_where=text("status = 'PENDING'"), sqlite_where=text("status = 'PENDING'"),
        ),
        Index(
            "uq_coop_applications_pending_kra_pin", "kra_pin", unique=True,
            postgresql_where=text("status = 'PENDING'"), sqlite_where=text("status = 'PENDING'"),
        ),
    )

class CoolerStatus:
    ACTIVE = "ACTIVE"      # in service (whether or not it is currently reporting)
    INACTIVE = "INACTIVE"  # decommissioned by an administrator


class Cooler(Base):
    __tablename__ = "coolers"
    __table_args__ = (
        Index("uq_coolers_cooperative_code", "cooperative_id", "code", unique=True),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"), nullable=False, index=True)
    centre_id = Column(Uuid, ForeignKey("collection_centres.id", ondelete="SET NULL"), nullable=True, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    location = Column(String(255))
    capacity_litres = Column(Numeric(10, 2))
    scale_device_id = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, default=CoolerStatus.ACTIVE, server_default=text("'ACTIVE'"))
    # Operational = online and usable right now; an ACTIVE cooler can be offline.
    is_operational = Column(Boolean, default=True)
    last_temperature_c = Column(Numeric(5, 2))
    last_reading_at = Column(DateTime)
    # The staff member in charge of this cooler (falls back to the centre's manager for alerts).
    manager_user_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Latest accepted level reading (cooler_readings keeps the full history).
    current_volume_litres = Column(Numeric(10, 2))
    last_seen_at = Column(DateTime)  # last time any sensor or device reported for this cooler
    # Alert thresholds; NULL = that alert is off.
    low_volume_alert_litres = Column(Numeric(10, 2))
    high_volume_alert_litres = Column(Numeric(10, 2))
    min_temperature_c = Column(Numeric(5, 2))
    max_temperature_c = Column(Numeric(5, 2))
    stale_after_minutes = Column(Integer)
    low_battery_percent = Column(Integer)
    alerts_enabled = Column(Boolean, nullable=False, default=True, server_default=true())
    sync_version = Column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    cooperative = relationship("Cooperative", back_populates="coolers", viewonly=True)
    centre = relationship("CollectionCentre", viewonly=True)


class SMSCreditPackage(Base):
    __tablename__ = "sms_credit_packages"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    credits_amount = Column(Integer, nullable=False)
    price_kes = Column(Numeric(10, 2), nullable=False)
    is_active = Column(Boolean, default=True)


class SMSCreditPayment(Base):
    __tablename__ = "sms_credit_payments"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"))
    package_id = Column(Uuid, ForeignKey("sms_credit_packages.id", ondelete="SET NULL"))
    amount_kes = Column(Numeric(10, 2), nullable=False)
    credits_requested = Column(Integer, nullable=False)
    mpesa_reference = Column(String, nullable=False)
    masked_mpesa_ref = Column(String, nullable=False)
    status = Column(String, default="PENDING")
    rejection_reason = Column(Text)
    submitted_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    verified_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    verified_at = Column(DateTime)
    # "Request information" round trip (PENDING -> AWAITING_INFORMATION -> PENDING); audit_logs keeps every round.
    info_request = Column(Text)
    info_requested_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    info_requested_at = Column(DateTime)
    info_response = Column(Text)
    info_responded_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    info_responded_at = Column(DateTime)

    cooperative = relationship("Cooperative", viewonly=True)
    package = relationship("SMSCreditPackage", viewonly=True)


class AuditLog(Base):
    """Append-only record of administrative changes. Rows are never updated or deleted by the API."""
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_cooperative_id", "cooperative_id"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_action", "action"),
    )

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    # The actor. Kept as `admin_id` (the original column); SET NULL so deleting a user never erases history.
    admin_id = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email = Column(String(255))   # snapshot, readable even if the account is later removed
    actor_role = Column(String(50))
    action = Column(String, nullable=False)
    target = Column(String, nullable=False)  # human-readable summary
    entity_type = Column(String(50))
    entity_id = Column(String(64))
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="SET NULL"), nullable=True)
    old_values = Column(JSON().with_variant(JSONB(), "postgresql"))
    new_values = Column(JSON().with_variant(JSONB(), "postgresql"))
    ip_address = Column(String(64))
    user_agent = Column(String(500))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    admin = relationship("models.user.User")

    @property
    def actor_id(self):
        return self.admin_id


class PlatformSetting(Base):
    """Platform-wide configuration, one row per key. Allowed keys and types live in services/settings.py."""
    __tablename__ = "platform_settings"

    key = Column(String(100), primary_key=True)
    value = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    updated_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
