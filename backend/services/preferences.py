"""Personal preferences, per role. Never secrets: the frontend may cache them offline.

Notification preferences are a fixed catalog per role (unknown keys are refused). Mandatory entries (security
notices) are always on, whatever is stored. Work preferences are validated against the caller's own cooperative
(a default centre or cooler from another cooperative is refused).
"""
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.admin import Cooler
from models.centre import CollectionCentre
from models.user import User, UserPreference
from schemas.auth import UserRole

# key -> (label, help, default, mandatory, inbox category it controls or None)
_COMMON = {
    "security": ("Security alerts", "Sign-ins, password and phone changes. Always on.", True, True, None),
    "system": ("System announcements", "Maintenance and product updates.", True, False, "SYSTEM"),
}
CATALOG: dict[str, dict[str, tuple]] = {
    UserRole.SUPER_ADMIN.value: {
        **_COMMON,
        "onboarding": ("Cooperative applications", "New applications waiting for review.", True, False, None),
        "payments": ("SMS credit payments", "Payments waiting for verification.", True, False, "PAYMENT"),
        "operational": ("Platform operations", "Sync problems, failed SMS and cooler incidents across cooperatives.", True, False, "SYNC"),
    },
    UserRole.COOP_ADMIN.value: {
        **_COMMON,
        "collections": ("Collections", "Corrections, reversals and unusual collections.", True, False, "COLLECTION"),
        "cooler_alerts": ("Cooler alerts", "Temperature, volume and sensor alerts.", True, False, "COOLER"),
        "sms": ("SMS & credits", "Low balance and failed messages.", True, False, "SMS"),
        "payments": ("Payments", "SMS credit payments and farmer payments.", True, False, "PAYMENT"),
        "operational": ("Operations", "Device sync and other operational alerts.", True, False, "SYNC"),
    },
    UserRole.MANAGER.value: {
        **_COMMON,
        "collections": ("Collections", "Corrections, reversals and unusual collections.", True, False, "COLLECTION"),
        "cooler_alerts": ("Cooler alerts", "Temperature, volume and sensor alerts.", True, False, "COOLER"),
        "farmer_alerts": ("Farmer alerts", "Farmer records that need attention.", True, False, None),
        "operational": ("Operations", "Device sync and other operational alerts.", True, False, "SYNC"),
        "sms": ("SMS status", "Failed or delayed messages.", True, False, "SMS"),
    },
    UserRole.COLLECTOR.value: {
        **_COMMON,
        "collections": ("Collections", "Confirmation of collections and correction decisions.", True, False, "COLLECTION"),
        "sync": ("Sync", "Records that failed to sync or need a decision.", True, False, "SYNC"),
        "device_alerts": ("Device alerts", "Scale and sensor problems.", True, False, "COOLER"),
        "sms": ("SMS status", "Receipts that could not be sent.", True, False, "SMS"),
    },
    UserRole.FARMER.value: {
        **_COMMON,
        "collection_receipts": ("Collection receipts", "A message for each collection recorded for you.", True, False, "COLLECTION"),
        "payments": ("Payments", "When a payment for your milk is ready.", True, False, "PAYMENT"),
        "cooperative": ("Cooperative news", "Announcements from your cooperative.", True, False, None),
    },
}

WORK_KEYS = {
    UserRole.SUPER_ADMIN.value: {"dashboard_range", "table_density"},
    UserRole.COOP_ADMIN.value: {"dashboard_range", "table_density", "default_centre_id"},
    UserRole.MANAGER.value: {"dashboard_range", "table_density", "default_centre_id"},
    UserRole.COLLECTOR.value: {"default_centre_id", "default_cooler_id", "confirm_before_submit", "scale_auto_capture", "receipt_preview"},
    UserRole.FARMER.value: {"dashboard_range"},
}
RANGES = {"today", "7d", "30d", "3m"}
DENSITIES = {"comfortable", "compact"}
WORK_DEFAULTS = {
    "dashboard_range": "7d", "table_density": "comfortable", "default_centre_id": None, "default_cooler_id": None,
    "confirm_before_submit": True, "scale_auto_capture": False, "receipt_preview": True,
}


def _row(db: Session, user: User) -> Optional[UserPreference]:
    return db.get(UserPreference, user.id)


def catalog_for(user: User) -> dict[str, tuple]:
    return CATALOG.get(user.role_value, _COMMON)


def muted_categories(db: Session, user: User) -> set[str]:
    """Inbox categories this person switched off (mandatory ones can't be)."""
    row = _row(db, user)
    stored = (row.notifications if row else None) or {}
    out = set()
    for key, (_label, _help, default, mandatory, category) in catalog_for(user).items():
        if category and not mandatory and not stored.get(key, default):
            out.add(category)
    return out


def get(db: Session, user: User) -> dict:
    row = _row(db, user)
    stored_n = (row.notifications if row else None) or {}
    stored_w = (row.work if row else None) or {}
    notifications = [
        {
            "key": key, "label": label, "help": help_text, "mandatory": mandatory,
            "enabled": True if mandatory else bool(stored_n.get(key, default)),
        }
        for key, (label, help_text, default, mandatory, _category) in catalog_for(user).items()
    ]
    allowed = WORK_KEYS.get(user.role_value, set())
    work = {key: stored_w.get(key, WORK_DEFAULTS[key]) for key in sorted(allowed)}
    return {"notifications": notifications, "work": work}


def _check_work(db: Session, user: User, work: dict[str, Any]) -> dict[str, Any]:
    allowed = WORK_KEYS.get(user.role_value, set())
    clean = {}
    for key, value in work.items():
        if key not in allowed:
            raise HTTPException(422, [{"loc": ["body", "work", key], "msg": "This preference isn't available for your account.", "type": "value_error"}])
        if key == "dashboard_range" and value not in RANGES:
            raise HTTPException(422, [{"loc": ["body", "work", key], "msg": "Choose today, 7d, 30d or 3m.", "type": "value_error"}])
        if key == "table_density" and value not in DENSITIES:
            raise HTTPException(422, [{"loc": ["body", "work", key], "msg": "Choose comfortable or compact.", "type": "value_error"}])
        if key in ("confirm_before_submit", "scale_auto_capture", "receipt_preview") and not isinstance(value, bool):
            raise HTTPException(422, [{"loc": ["body", "work", key], "msg": "Choose on or off.", "type": "value_error"}])
        if key in ("default_centre_id", "default_cooler_id") and value is not None:
            model = CollectionCentre if key == "default_centre_id" else Cooler
            try:
                from uuid import UUID

                row = db.get(model, UUID(str(value)))
            except ValueError:
                row = None
            # Someone else's centre or cooler looks exactly like a missing one.
            if row is None or row.cooperative_id != user.cooperative_id:
                raise HTTPException(422, [{"loc": ["body", "work", key], "msg": "Choose one of your cooperative's own.", "type": "value_error"}])
            value = str(row.id)
        clean[key] = value
    return clean


def update(db: Session, user: User, notifications: Optional[dict[str, bool]], work: Optional[dict[str, Any]]) -> dict:
    row = _row(db, user)
    if row is None:
        row = UserPreference(user_id=user.id, notifications={}, work={})
        db.add(row)
    if notifications is not None:
        catalog = catalog_for(user)
        merged = dict(row.notifications or {})
        for key, value in notifications.items():
            if key not in catalog:
                raise HTTPException(422, [{"loc": ["body", "notifications", key], "msg": "Unknown notification type.", "type": "value_error"}])
            if not isinstance(value, bool):
                raise HTTPException(422, [{"loc": ["body", "notifications", key], "msg": "Choose on or off.", "type": "value_error"}])
            if catalog[key][3] and value is False:
                raise HTTPException(422, [{"loc": ["body", "notifications", key], "msg": "Security alerts can't be turned off.", "type": "value_error"}])
            merged[key] = value
        row.notifications = merged
    if work is not None:
        row.work = {**(row.work or {}), **_check_work(db, user, work)}
    db.commit()
    return get(db, user)
