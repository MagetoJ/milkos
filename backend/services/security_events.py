"""Security events (sign-ins, password and phone changes, activation, MFA, session revocation, lockouts).

They are rows in the existing append-only audit_logs table, with entity_type "security" and entity_id the
account concerned, so there is one audit trail, not two. Unlike services.audit.record, an event can be written
without a signed-in actor (a failed sign-in, a public activation step).

Never pass a password, code, token or JWT in `details`; the keys below are refused outright.
"""
from typing import Any, Optional

from sqlalchemy.orm import Session

from core.utils import iso
from models.admin import AuditLog
from models.user import User

ENTITY = "security"
_FORBIDDEN_KEYS = {"password", "password_hash", "code", "otp", "token", "access_token", "session_token", "secret", "mfa_secret"}

LABELS = {
    "LOGIN_SUCCESS": "Signed in",
    "LOGIN_FAILED": "Failed sign-in attempt",
    "LOGIN_LOCKED": "Sign-in locked after repeated failures",
    "LOGIN_BLOCKED": "Sign-in refused (account not active)",
    "LOGOUT": "Signed out",
    "MFA_CHALLENGE_FAILED": "Wrong authentication code",
    "MFA_ENABLED": "Two-step verification turned on",
    "MFA_DISABLED": "Two-step verification turned off",
    "MFA_RECOVERY_CODE_USED": "Recovery code used to sign in",
    "PASSWORD_CHANGED": "Password changed",
    "PASSWORD_CREATED": "Password created",
    "PASSWORD_RESET_REQUESTED": "Password reset requested",
    "PASSWORD_RESET_COMPLETED": "Password reset",
    "ACCOUNT_CREATED": "Account created",
    "ACTIVATION_SMS_REQUESTED": "Activation SMS requested",
    "ACTIVATION_SMS_SENT": "Activation SMS sent",
    "ACTIVATION_SMS_FAILED": "Activation SMS failed",
    "ACTIVATION_LINK_OPENED": "Activation link opened",
    "ACTIVATION_RESENT": "Activation link resent",
    "ACTIVATION_REVOKED": "Invitation revoked",
    "ACTIVATION_COMPLETED": "Account activated",
    "OTP_REQUESTED": "Verification code sent",
    "OTP_VERIFIED": "Verification code accepted",
    "OTP_FAILED": "Wrong verification code",
    "PHONE_CHANGE_REQUESTED": "Phone number change requested",
    "PHONE_CHANGED": "Phone number changed",
    "PHONE_VERIFIED": "Phone number verified",
    "SESSION_REVOKED": "Session signed out",
    "SESSIONS_REVOKED": "Other sessions signed out",
    "ACCOUNT_SUSPENDED": "Account suspended",
    "ACCOUNT_REACTIVATED": "Account reactivated",
    "ACCOUNT_DISABLED": "Account disabled",
    "ROLE_CHANGED": "Role changed",
    "DEVICE_REGISTERED": "Device registered",
    "SUSPICIOUS_ACTIVITY": "Suspicious activity",
}


def record(
    db: Session, action: str, *, user: Optional[User], actor: Optional[User] = None,
    ip_address: Optional[str] = None, user_agent: Optional[str] = None, details: Optional[dict[str, Any]] = None,
    target: Optional[str] = None,
) -> AuditLog:
    """Add (not commit) one security event about `user`, done by `actor` (default: the user themself)."""
    clean = {k: v for k, v in (details or {}).items() if k.lower() not in _FORBIDDEN_KEYS}
    who = actor or user
    entry = AuditLog(
        admin_id=who.id if who else None,
        actor_email=who.email if who else None,
        actor_role=who.role_value if who else None,
        action=action,
        target=(target or (f"{LABELS.get(action, action)}: {user.label}" if user else LABELS.get(action, action)))[:500],
        entity_type=ENTITY,
        entity_id=str(user.id) if user else None,
        cooperative_id=user.cooperative_id if user else None,
        new_values=clean or None,
        ip_address=(ip_address or None) and ip_address[:64],
        user_agent=(user_agent or None) and user_agent[:500],
    )
    db.add(entry)
    return entry


def from_principal(db: Session, principal, action: str, *, user: Optional[User] = None, details: Optional[dict] = None) -> AuditLog:
    return record(
        db, action, user=user or principal.user, actor=principal.user, ip_address=principal.ip_address,
        user_agent=principal.user_agent, details=details,
    )


def event_json(entry: AuditLog) -> dict:
    return {
        "id": str(entry.id),
        "action": entry.action,
        "label": LABELS.get(entry.action, entry.action.replace("_", " ").title()),
        "actor_email": entry.actor_email,
        "actor_role": entry.actor_role,
        "ip_address": entry.ip_address,
        "user_agent": entry.user_agent,
        "details": entry.new_values,
        "created_at": iso(entry.created_at),
    }


def for_user(db: Session, user_id, limit: int = 50) -> list[AuditLog]:
    return (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == ENTITY, AuditLog.entity_id == str(user_id))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
