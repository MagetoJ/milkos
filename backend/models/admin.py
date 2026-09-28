from sqlalchemy import Column, String, Numeric, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import datetime

from db import Base

class CooperativeApplication(Base):
    __tablename__ = "cooperative_applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_name = Column(String, nullable=False)
    applicant_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    location = Column(String, nullable=False)
    status = Column(String, default="PENDING")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Cooler(Base):
    __tablename__ = "coolers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(UUID(as_uuid=True), ForeignKey("cooperatives.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    location = Column(String)
    scale_device_id = Column(String, nullable=True)
    is_operational = Column(Boolean, default=True)

class SMSCreditPayment(Base):
    __tablename__ = "sms_credit_payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cooperative_id = Column(UUID(as_uuid=True), ForeignKey("cooperatives.id", ondelete="CASCADE"))
    amount_kes = Column(Numeric(10, 2), nullable=False)
    credits_requested = Column(Numeric(10, 0), nullable=False)
    mpesa_reference = Column(String, nullable=False)
    masked_mpesa_ref = Column(String, nullable=False)
    status = Column(String, default="PENDING")
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action = Column(String, nullable=False)
    target = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    admin = relationship("models.user.User")