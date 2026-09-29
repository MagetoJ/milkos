from sqlalchemy import (
    JSON, Column, String, Numeric, Boolean, DateTime, ForeignKey, Index, Integer, Text, Uuid, text,
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

class Cooler(Base):
    __tablename__ = "coolers"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    location = Column(String)
    scale_device_id = Column(String, nullable=True)
    is_operational = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

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
    verified_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    verified_at = Column(DateTime)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    admin_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action = Column(String, nullable=False)
    target = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    admin = relationship("models.user.User")
