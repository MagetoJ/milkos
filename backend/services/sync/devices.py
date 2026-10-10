"""Devices and offline sessions.

A device is one installation of the MilkOS app, identified by a random UUID it generated itself (no
fingerprinting). After a normal online login the app registers the device and receives an offline
session: a random secret (only its SHA-256 hash is stored here) with an expiry. The secret lets the
device:

  - keep working offline until the expiry, for that one user (the role and cooperative it caches are
    for display only; the server re-checks everything on every request), and
  - exchange the secret for a fresh access token when it reconnects (POST /api/v1/devices/session/refresh).
    That exchange re-reads the account: an inactive user, a changed cooperative, a suspended cooperative,
    a deactivated device or a revoked/expired session all fail.

Sessions slide: each successful online use pushes the expiry OFFLINE_SESSION_DAYS (default 7) ahead.
Secrets rotate on refresh; the previous one stays valid for ROTATION_GRACE so a lost response can't
lock a device out.

A device belongs to the cooperative of the first cooperative user who registers it and can't be used to
sync for any other cooperative until a cooperative admin deactivates it or platform staff release it.
"""
import datetime
import hashlib
import logging
import os
import secrets
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.access import Principal
from core.permissions import permissions_for
from core.utils import iso
from models.cooperative import Cooperative, CooperativeStatus
from models.sync import Device, DeviceSession
from models.user import User
from schemas.auth import UserRole
from schemas.sync import DeviceRegister
from services import audit

logger = logging.getLogger("milkflow.sync")

ROTATION_GRACE = datetime.timedelta(minutes=10)
UNAUTHORIZED_DEVICE = "This device isn't registered for your account. Sign in online to set it up again."


def session_days() -> int:
    return max(1, min(int(os.getenv("OFFLINE_SESSION_DAYS", "7")), 30))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def device_json(device: Device, cooperative_name: Optional[str] = None) -> dict:
    return {
        "id": str(device.id),
        "device_identifier": device.device_identifier,
        "cooperative_id": str(device.cooperative_id) if device.cooperative_id else None,
        "cooperative_name": cooperative_name,
        "label": device.label,
        "platform": device.platform,
        "app_version": device.app_version,
        "is_active": bool(device.is_active),
        "last_seen_at": iso(device.last_seen_at),
        "last_sync_at": iso(device.last_sync_at),
        "created_at": iso(device.created_at),
    }


def offline_session_json(db: Session, user: User, session: DeviceSession, device: Device, token: str) -> dict:
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    role = user.role_value
    return {
        "token": token,
        "issued_at": iso(session.issued_at),
        "expires_at": iso(session.expires_at),
        "device": device_json(device, coop.name if coop else None),
        "user": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": role,
            "cooperative_id": str(coop.id) if coop else None,
            "cooperative_name": coop.name if coop else None,
            "cooperative_code": coop.code if coop else None,
        },
        # For showing/hiding UI only; every request is re-authorised on the server.
        "permissions": sorted(p.value for p in permissions_for(role)),
    }


def _issue(session: DeviceSession, now: datetime.datetime, keep_previous: bool) -> str:
    token = secrets.token_urlsafe(32)
    if keep_previous and session.token_hash:
        session.previous_token_hash = session.token_hash
        session.previous_valid_until = now + ROTATION_GRACE
    else:
        session.previous_token_hash = None
        session.previous_valid_until = None
    session.token_hash = _hash(token)
    session.expires_at = now + datetime.timedelta(days=session_days())
    session.last_validated_at = now
    session.revoked_at = None
    return token


def register(db: Session, principal: Principal, payload: DeviceRegister) -> tuple[Device, DeviceSession, str]:
    now = datetime.datetime.utcnow()
    device = db.query(Device).filter(Device.device_identifier == payload.device_identifier).first()
    created = device is None
    if created:
        device = Device(
            device_identifier=payload.device_identifier, cooperative_id=principal.cooperative_id,
            registered_by=principal.user.id, is_active=True,
        )
        db.add(device)
    else:
        if not device.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This device has been deactivated by your administrator.")
        if not principal.is_superadmin:
            if device.cooperative_id is None:
                device.cooperative_id = principal.cooperative_id
                created = True  # newly bound: worth an audit entry
            elif device.cooperative_id != principal.cooperative_id:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "This device is registered to another cooperative. Ask that cooperative's admin to deactivate "
                    "it, or contact platform support to release it.",
                )
    device.platform = payload.platform or device.platform
    device.app_version = payload.app_version or device.app_version
    device.label = payload.label or device.label
    device.user_agent = principal.user_agent or device.user_agent
    device.last_seen_at = now
    db.flush()

    session = db.query(DeviceSession).filter(
        DeviceSession.device_id == device.id, DeviceSession.user_id == principal.user.id
    ).first()
    if session is None:
        session = DeviceSession(device_id=device.id, user_id=principal.user.id, issued_at=now)
        db.add(session)
    else:
        session.issued_at = now
    token = _issue(session, now, keep_previous=False)

    if created:
        audit.record(
            db, principal, "DEVICE_REGISTERED", target=f"Device {device.label or device.device_identifier[:8]}",
            entity_type="device", entity_id=device.id, cooperative_id=device.cooperative_id,
            new_values={"device_identifier": device.device_identifier, "platform": device.platform},
        )
    if session.id is None or created:
        from services import security_events

        security_events.from_principal(db, principal, "DEVICE_REGISTERED", details={"device": device.label or device.device_identifier[:8]})
    db.commit()
    db.refresh(device)
    db.refresh(session)
    logger.info("device_registered device=%s user=%s new=%s", device.id, principal.user.id, created)
    return device, session, token


def _find_session(db: Session, device_identifier: str, token: str) -> tuple[Optional[Device], Optional[DeviceSession]]:
    device = db.query(Device).filter(Device.device_identifier == device_identifier).first()
    if device is None:
        return None, None
    digest = _hash(token)
    session = db.query(DeviceSession).filter(DeviceSession.device_id == device.id, DeviceSession.token_hash == digest).first()
    if session is None:
        now = datetime.datetime.utcnow()
        session = db.query(DeviceSession).filter(
            DeviceSession.device_id == device.id, DeviceSession.previous_token_hash == digest,
            DeviceSession.previous_valid_until >= now,
        ).first()
    return device, session


def refresh(db: Session, device_identifier: str, token: str) -> tuple[User, Device, DeviceSession, str]:
    """Revalidate an offline session against the database and rotate its secret."""
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Your offline session has ended. Sign in again.")
    device, session = _find_session(db, device_identifier, token)
    now = datetime.datetime.utcnow()
    if device is None or session is None or session.revoked_at is not None or session.expires_at < now:
        raise invalid
    if not device.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This device has been deactivated by your administrator.")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise invalid
    if user.role_value != UserRole.SUPER_ADMIN.value:
        coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
        if coop is None or (device.cooperative_id is not None and device.cooperative_id != coop.id):
            raise invalid  # moved to another cooperative since this device was set up
        if coop.status != CooperativeStatus.ACTIVE:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This cooperative is suspended. Contact the platform administrator.")
    new_token = _issue(session, now, keep_previous=True)
    device.last_seen_at = now
    db.commit()
    db.refresh(session)
    logger.info("offline_session_refreshed device=%s user=%s", device.id, user.id)
    return user, device, session, new_token


def revoke(db: Session, device_identifier: str, token: str) -> bool:
    device, session = _find_session(db, device_identifier, token)
    if session is None:
        return False
    session.revoked_at = datetime.datetime.utcnow()
    db.commit()
    logger.info("offline_session_revoked device=%s user=%s", device.id, session.user_id)
    return True


def authorize(db: Session, principal: Principal, device_identifier: Optional[str]) -> tuple[Device, DeviceSession]:
    """The registered, active device a sync request comes from, with this user's live session on it."""
    forbidden = HTTPException(status.HTTP_403_FORBIDDEN, UNAUTHORIZED_DEVICE)
    if not device_identifier:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The X-Device-Id header is required for sync requests.")
    device = db.query(Device).filter(Device.device_identifier == device_identifier).first()
    if device is None:
        raise forbidden
    if not device.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This device has been deactivated by your administrator.")
    if not principal.is_superadmin and device.cooperative_id != principal.cooperative_id:
        raise forbidden
    session = db.query(DeviceSession).filter(
        DeviceSession.device_id == device.id, DeviceSession.user_id == principal.user.id
    ).first()
    now = datetime.datetime.utcnow()
    if session is None or session.revoked_at is not None or session.expires_at < now:
        raise forbidden
    # Online use renews the offline window.
    session.expires_at = now + datetime.timedelta(days=session_days())
    session.last_validated_at = now
    device.last_seen_at = now
    principal.device = device
    return device, session


def set_active(db: Session, principal: Principal, device: Device, active: bool, label: Optional[str] = None) -> Device:
    now = datetime.datetime.utcnow()
    if label is not None:
        device.label = label
    if device.is_active != active:
        device.is_active = active
        if not active:
            for s in db.query(DeviceSession).filter(DeviceSession.device_id == device.id, DeviceSession.revoked_at.is_(None)):
                s.revoked_at = now
        audit.record(
            db, principal, "DEVICE_ACTIVATED" if active else "DEVICE_DEACTIVATED",
            target=f"Device {device.label or device.device_identifier[:8]}", entity_type="device",
            entity_id=device.id, cooperative_id=device.cooperative_id,
        )
    db.commit()
    db.refresh(device)
    return device


def release(db: Session, principal: Principal, device: Device) -> Device:
    """Platform staff: unbind a device from its cooperative and end its sessions."""
    now = datetime.datetime.utcnow()
    old = device.cooperative_id
    device.cooperative_id = None
    for s in db.query(DeviceSession).filter(DeviceSession.device_id == device.id, DeviceSession.revoked_at.is_(None)):
        s.revoked_at = now
    audit.record(
        db, principal, "DEVICE_RELEASED", target=f"Device {device.label or device.device_identifier[:8]}",
        entity_type="device", entity_id=device.id, cooperative_id=old,
        old_values={"cooperative_id": str(old) if old else None},
    )
    db.commit()
    db.refresh(device)
    return device


def active_session_counts(db: Session, cooperative_id: UUID) -> int:
    now = datetime.datetime.utcnow()
    return (
        db.query(DeviceSession).join(Device, Device.id == DeviceSession.device_id)
        .filter(Device.cooperative_id == cooperative_id, DeviceSession.revoked_at.is_(None), DeviceSession.expires_at >= now)
        .count()
    )
