from sqlalchemy import Column, String, Integer, Numeric, DateTime, Uuid, text
import uuid
import datetime

from db import Base


class CooperativeStatus:
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"


class Cooperative(Base):
    """Created only by approving a CooperativeApplication (routers/superadmin.py)."""
    __tablename__ = "cooperatives"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    # Short public identifier (e.g. LIMURU-4F2A) for SMS, partner APIs and support calls.
    code = Column(String(50), unique=True, nullable=False)
    registration_number = Column(String(50), unique=True, nullable=False)
    kra_pin = Column(String(11), unique=True, nullable=False)
    county = Column(String(50), nullable=False)
    location = Column(String(255))  # sub-county / town
    status = Column(String(20), nullable=False, default=CooperativeStatus.ACTIVE, server_default=text("'ACTIVE'"))
    sms_credit_balance = Column(Integer, nullable=False, default=0, server_default=text("0"))
    estimated_daily_liters = Column(Numeric(12, 2))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
