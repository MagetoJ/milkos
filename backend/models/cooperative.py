from sqlalchemy import Boolean, Column, String, Integer, Numeric, DateTime, Text, Uuid, text, true
from sqlalchemy.orm import relationship
import uuid
import datetime

from db import Base


class CooperativeStatus:
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"


class Cooperative(Base):
    """Created by approving a CooperativeApplication, or directly by a superadmin."""
    __tablename__ = "cooperatives"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    # Short public identifier (e.g. LIMURU-4F2A) for SMS, partner APIs and support calls.
    code = Column(String(50), unique=True, nullable=False)
    registration_number = Column(String(50), unique=True, nullable=False)
    kra_pin = Column(String(11), unique=True, nullable=False)
    county = Column(String(50), nullable=False)
    location = Column(String(255))  # sub-county / town
    contact_email = Column(String(255))
    contact_phone = Column(String(50))
    status = Column(String(20), nullable=False, default=CooperativeStatus.ACTIVE, server_default=text("'ACTIVE'"))
    suspension_reason = Column(Text)
    suspended_at = Column(DateTime)
    # Cache of the available balance; the authoritative figure is derived from sms_credit_transactions
    # (services/sms_credits.py) and this column is rewritten in the same transaction as every ledger entry.
    sms_credit_balance = Column(Integer, nullable=False, default=0, server_default=text("0"))
    estimated_daily_liters = Column(Numeric(12, 2))
    # Cooler alert SMS to the cooperative's admins and the responsible manager (see services/cooler_alerts).
    alert_sms_enabled = Column(Boolean, nullable=False, default=True, server_default=true())
    # SMS receipt to the farmer for every confirmed collection allocation (costs one credit each).
    receipt_sms_enabled = Column(Boolean, nullable=False, default=True, server_default=true())
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Read-side navigation only; rows are removed by the database's ON DELETE rules, never by the ORM.
    users = relationship("User", back_populates="cooperative", viewonly=True)
    farmers = relationship("Farmer", back_populates="cooperative", viewonly=True)
    collectors = relationship("Collector", back_populates="cooperative", viewonly=True)
    coolers = relationship("Cooler", back_populates="cooperative", viewonly=True)
    centres = relationship("CollectionCentre", back_populates="cooperative", viewonly=True)
    collections = relationship("MilkCollection", back_populates="cooperative", viewonly=True)
