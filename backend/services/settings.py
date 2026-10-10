"""Platform settings: a fixed registry of typed keys, stored in platform_settings.

Unknown keys are refused, values are validated against their type, and every change is audited.
"""
from typing import Any, Optional

from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import field_error, iso
from core.validation import normalize_email, normalize_phone
from models.admin import PlatformSetting
from services import audit

REGISTRY: dict[str, dict[str, Any]] = {
    "onboarding.accepting_applications": {
        "type": "boolean", "default": True, "group": "Onboarding",
        "label": "Accept new cooperative applications",
        "help": "When off, the public registration form is closed.",
    },
    "collection.max_temperature_c": {
        "type": "number", "default": None, "min": 0, "max": 30, "group": "Milk quality",
        "label": "Reject milk warmer than (°C)",
        "help": "Collections recorded above this temperature are marked rejected automatically. Empty = no limit.",
    },
    "collection.min_fat_percentage": {
        "type": "number", "default": None, "min": 0, "max": 15, "group": "Milk quality",
        "label": "Reject milk with butterfat below (%)",
        "help": "Collections recorded below this fat percentage are marked rejected automatically. Empty = no limit.",
    },
    "collection.density_kg_per_litre": {
        "type": "number", "default": 1.03, "min": 0.9, "max": 1.2, "group": "Milk quality",
        "label": "Milk density (KG per litre)",
        "help": "Converts between KG (what scales weigh) and litres (what coolers hold). Each collection keeps the factor it was recorded with.",
    },
    "sms.receipt_template": {
        "type": "text",
        "default": "MilkOS:\nCollection received: {kg} KG\nCentre: {centre}\nDate: {date}\nCollection Ref: {reference}",
        "max_length": 300, "group": "SMS credits",
        "label": "Collection receipt SMS",
        "help": "Placeholders: {kg}, {farmer}, {centre}, {cooler}, {date}, {reference}, {cooperative}. One SMS credit per receipt.",
    },
    "sms.low_balance_threshold": {
        "type": "integer", "default": 100, "min": 0, "max": 10_000_000, "group": "SMS credits",
        "label": "Low SMS balance warning at",
        "help": "Cooperatives at or below this many credits are flagged on the dashboard.",
    },
    "security.activation_link_minutes": {
        "type": "integer", "default": 30, "min": 10, "max": 10080, "group": "Account security",
        "label": "Activation links expire after (minutes)",
        "help": "How long the SMS activation link sent to a new account stays valid. A new link can always be sent.",
    },
    "security.activation_requires_otp": {
        "type": "boolean", "default": True, "group": "Account security",
        "label": "Confirm the phone with a code during activation",
        "help": "When on, people activating an account also enter a 6-digit code sent to their phone.",
    },
    "security.password_reset_minutes": {
        "type": "integer", "default": 30, "min": 10, "max": 1440, "group": "Account security",
        "label": "Password reset links expire after (minutes)",
        "help": "How long a password reset link stays valid.",
    },
    "platform.support_email": {
        "type": "email", "default": None, "group": "Support",
        "label": "Support email", "help": "Shown to cooperatives that need help.",
    },
    "platform.support_phone": {
        "type": "phone", "default": None, "group": "Support",
        "label": "Support phone", "help": "Shown to cooperatives that need help.",
    },
}


def _validate(key: str, value: Any) -> Any:
    spec = REGISTRY[key]
    if value is None or value == "":
        if spec["type"] == "boolean":
            raise field_error(key, "Choose on or off.")
        return None
    kind = spec["type"]
    try:
        if kind == "boolean":
            if not isinstance(value, bool):
                raise ValueError("Choose on or off.")
            return value
        if kind in ("number", "integer"):
            if isinstance(value, bool):
                raise ValueError("Enter a number.")
            number = int(value) if kind == "integer" else float(value)
            if kind == "integer" and float(value) != number:
                raise ValueError("Enter a whole number.")
            if number < spec.get("min", float("-inf")) or number > spec.get("max", float("inf")):
                raise ValueError(f"Enter a value between {spec['min']} and {spec['max']}.")
            return number
        if kind == "email":
            email = normalize_email(str(value))
            if "@" not in email or "." not in email.split("@")[-1]:
                raise ValueError("Enter a valid email address.")
            return email
        if kind == "phone":
            return normalize_phone(str(value))
        if kind == "text":
            text = str(value).strip()
            if len(text) > spec.get("max_length", 1000):
                raise ValueError(f"Use at most {spec.get('max_length', 1000)} characters.")
            if key == "sms.receipt_template":
                try:
                    text.format(kg="1", farmer="", centre="", cooler="", date="", reference="", cooperative="")
                except (KeyError, IndexError, ValueError):
                    raise ValueError("Use only the listed placeholders, in braces, e.g. {kg}.")
            return text
    except (TypeError, ValueError) as exc:
        message = str(exc) if str(exc) and not str(exc).startswith(("invalid literal", "could not convert")) else "Enter a valid value."
        raise field_error(key, message)
    raise field_error(key, "Unsupported setting.")  # pragma: no cover


def get(db: Session, key: str) -> Any:
    row = db.get(PlatformSetting, key)
    return row.value if row is not None else REGISTRY[key]["default"]


def list_all(db: Session) -> list[dict]:
    stored = {row.key: row for row in db.query(PlatformSetting).all()}
    out = []
    for key, spec in REGISTRY.items():
        row = stored.get(key)
        out.append({
            "key": key,
            "value": row.value if row is not None else spec["default"],
            "default": spec["default"],
            "type": spec["type"],
            "group": spec["group"],
            "label": spec["label"],
            "help": spec["help"],
            "min": spec.get("min"),
            "max": spec.get("max"),
            "updated_at": iso(row.updated_at) if row is not None else None,
        })
    return out


def update(db: Session, principal: Principal, values: dict[str, Any]) -> list[dict]:
    unknown = [key for key in values if key not in REGISTRY]
    if unknown:
        raise field_error(unknown[0], "Unknown setting.")
    clean = {key: _validate(key, value) for key, value in values.items()}

    old: dict[str, Optional[Any]] = {}
    new: dict[str, Optional[Any]] = {}
    for key, value in clean.items():
        current = get(db, key)
        if current == value:
            continue
        old[key], new[key] = current, value
        row = db.get(PlatformSetting, key)
        if row is None:
            db.add(PlatformSetting(key=key, value=value, updated_by=principal.user.id))
        else:
            row.value = value
            row.updated_by = principal.user.id
    if new:
        audit.record(
            db, principal, "SETTINGS_UPDATED", target=", ".join(REGISTRY[k]["label"] for k in new),
            entity_type="settings", old_values=old, new_values=new,
        )
        db.commit()
    return list_all(db)
