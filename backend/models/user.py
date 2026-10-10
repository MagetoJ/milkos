from sqlalchemy import (
    JSON, Column, Index, String, Boolean, DateTime, ForeignKey, Integer, Text, Uuid, Enum as SQLEnum, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
import uuid
import datetime
from db import Base
from schemas.auth import UserRole


class AccountStatus:
    """The one account-state field. `users.is_active` is kept equal to (status == ACTIVE) by User.set_status,
    so every existing `is_active` check keeps working and can never disagree with the status.

        PENDING_APPROVAL    self-registered cooperative applicant awaiting platform review (password set by them)
        PENDING_ACTIVATION  created by an administrator; the person must open the SMS link and set a password
                            (this is the "invited" state: there is no separate INVITED value)
        ACTIVE              normal sign-in
        SUSPENDED           temporarily blocked by an administrator (reversible)
        DISABLED            switched off (reversible by an administrator; history is kept)
    """
    PENDING_APPROVAL = "PENDING_APPROVAL"
    PENDING_ACTIVATION = "PENDING_ACTIVATION"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"

    ALL = (PENDING_APPROVAL, PENDING_ACTIVATION, ACTIVE, SUSPENDED, DISABLED)


class User(Base):
    __tablename__ = "users"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    # Optional for collectors and farmers (they sign in with their phone number); unique when present.
    email = Column(String(255), unique=True, nullable=True)
    # NULL until the person sets their own password during activation. Never set by an administrator.
    password_hash = Column(String(255), nullable=True)
    full_name = Column(String(255), nullable=False)
    # Always stored in E.164 (see core.validation.normalize_phone); unique across all accounts, because it
    # is a sign-in identifier and the channel for activation, OTP and password-reset messages.
    phone_number = Column(String(50), unique=True, nullable=False)
    role = Column(SQLEnum(UserRole, name="user_role"), default=UserRole.FARMER)
    cooperative_id = Column(Uuid, ForeignKey("cooperatives.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)
    account_status = Column(String(30), nullable=False, default=AccountStatus.ACTIVE, server_default=text("'ACTIVE'"), index=True)
    status_reason = Column(Text)
    # Phone ownership proven (activation OTP, or OTP on a phone change). Updated on every verification.
    phone_verified_at = Column(DateTime)
    password_set_at = Column(DateTime)
    # Backend-enforced: while true, the account may only change its password (see core.access).
    must_change_password = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    invited_at = Column(DateTime)
    invited_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    activated_at = Column(DateTime)
    # Bumped to end every access token issued before (password change, session revocation, suspension).
    session_epoch = Column(Integer, nullable=False, default=0, server_default=text("0"))
    failed_login_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    locked_until = Column(DateTime)
    # TOTP multi-factor authentication. The secret is encrypted (core.secrets); recovery codes are hashed.
    mfa_enabled = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    mfa_secret_encrypted = Column(Text)
    mfa_enabled_at = Column(DateTime)
    mfa_recovery_codes = Column(JSON().with_variant(JSONB(), "postgresql"))
    last_login_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    cooperative = relationship("Cooperative", back_populates="users", viewonly=True)

    @property
    def role_value(self) -> str:
        return self.role.value if isinstance(self.role, UserRole) else str(self.role)

    @property
    def status_value(self) -> str:
        status = self.account_status or AccountStatus.ACTIVE
        # Code that still switches `is_active` off directly can never leave a status that claims ACTIVE.
        if status == AccountStatus.ACTIVE and self.is_active is False:
            return AccountStatus.DISABLED
        return status

    @property
    def label(self) -> str:
        """How the account is named in audit entries: never a secret, never the full phone number."""
        return f"{self.full_name} <{self.email}>" if self.email else f"{self.full_name} ({self.role_value})"

    def set_status(self, status: str, reason: str | None = None) -> None:
        if status not in AccountStatus.ALL:
            raise ValueError(f"Unknown account status {status}")
        self.account_status = status
        self.is_active = status == AccountStatus.ACTIVE
        self.status_reason = reason
        if status != AccountStatus.ACTIVE:
            # Signed-in sessions end now, not when their token expires.
            self.session_epoch = (self.session_epoch or 0) + 1


class AccountActivation(Base):
    """One-time activation link for an administrator-created account. Only a SHA-256 hash of the token is
    stored; the raw token exists only in the SMS. Issuing a new one revokes every older open one."""
    __tablename__ = "account_activations"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    opened_at = Column(DateTime)
    otp_verified_at = Column(DateTime)
    used_at = Column(DateTime)
    revoked_at = Column(DateTime)
    revoked_reason = Column(String(100))
    notification_id = Column(Uuid, ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True)


class PasswordReset(Base):
    """Password reset for an existing ACTIVE account. Deliberately separate from account_activations: the two
    flows never share tokens or state."""
    __tablename__ = "password_resets"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    requested_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # NULL = self-service
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime)
    revoked_at = Column(DateTime)
    notification_id = Column(Uuid, ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True)


class OtpPurpose:
    ACTIVATION = "ACTIVATION"
    PHONE_CHANGE = "PHONE_CHANGE"
    ALL = (ACTIVATION, PHONE_CHANGE)


class PhoneVerification(Base):
    """An SMS one-time code proving control of `phone`. The code is stored only as a keyed hash."""
    __tablename__ = "phone_verifications"
    __table_args__ = (Index("ix_phone_verifications_user_purpose", "user_id", "purpose", "created_at"),)

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose = Column(String(20), nullable=False)
    phone = Column(String(50), nullable=False)
    activation_id = Column(Uuid, ForeignKey("account_activations.id", ondelete="CASCADE"), nullable=True)
    code_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    last_sent_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    send_count = Column(Integer, nullable=False, default=1, server_default=text("1"))
    attempts = Column(Integer, nullable=False, default=0, server_default=text("0"))
    verified_at = Column(DateTime)
    revoked_at = Column(DateTime)
    requested_by = Column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notification_id = Column(Uuid, ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True)


class UserPreference(Base):
    """Personal preferences (notifications, work defaults, display). Never secrets; safe to cache offline."""
    __tablename__ = "user_preferences"

    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notifications = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    work = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
