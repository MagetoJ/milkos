from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Uuid, Enum as SQLEnum
import uuid
import datetime
from db import Base
from schemas.auth import UserRole

class User(Base):
    __tablename__ = "users"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    # Always stored in E.164 (see core.validation.normalize_phone); unique across all accounts.
    phone_number = Column(String(50), unique=True, nullable=False)
    role = Column(SQLEnum(UserRole, name="user_role"), default=UserRole.FARMER)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
