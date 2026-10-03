"""Small helpers shared by the routers and services."""
import re
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Iterable, Optional
from uuid import UUID

from fastapi import HTTPException, status


def iso(value: Optional[datetime | date | time]) -> Optional[str]:
    """Columns store naive UTC; mark datetimes as UTC so browsers don't read them as local time."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    return value.isoformat()


def num(value: Optional[Decimal | float | int]) -> Optional[float]:
    return float(value) if value is not None else None


def parse_uuid(value: str, what: str) -> UUID:
    """A malformed id is just another id that doesn't exist."""
    try:
        return UUID(str(value))
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def field_error(field: str, message: str, code: int = 422) -> HTTPException:
    """Error shaped like FastAPI's validation errors so forms map it to the field."""
    return HTTPException(code, detail=[{"loc": ["body", field], "msg": message, "type": "invalid"}])


def conflict(field: Optional[str], message: str) -> HTTPException:
    loc = ["body", field] if field else ["body"]
    return HTTPException(status.HTTP_409_CONFLICT, detail=[{"loc": loc, "msg": message, "type": "conflict"}])


def reject_nulls(data: dict, *fields: str) -> None:
    for name in fields:
        if name in data and data[name] is None:
            raise field_error(name, "This field can't be empty.")


def next_sequence(values: Iterable[Optional[str]], prefix: str, width: int) -> str:
    """Next number in a PREFIX-0001 series, ignoring values that don't follow the pattern."""
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for value in values:
        match = pattern.match(value or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}-{highest + 1:0{width}d}"


def like(term: str) -> str:
    """`%term%` with LIKE wildcards in the user's text escaped (use with escape='\\\\')."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def phone_digits(term: str) -> Optional[str]:
    """The national part of a phone number typed as 07.., 2547.., +2547.. (for LIKE matching)."""
    if not re.fullmatch(r"\+?\d+", term):
        return None
    digits = term.lstrip("+")
    digits = digits[1:] if digits.startswith("0") else digits[3:] if digits.startswith("254") else digits
    return digits if len(digits) >= 3 else None


def snapshot(row: Any, fields: Iterable[str]) -> dict:
    """JSON-safe dict of `fields` on `row`, used for audit old/new values."""
    out = {}
    for name in fields:
        value = getattr(row, name, None)
        if hasattr(value, "value") and not isinstance(value, (str, bytes)):
            value = value.value  # enums
        if isinstance(value, UUID):
            value = str(value)
        elif isinstance(value, Decimal):
            value = float(value)
        elif isinstance(value, (datetime, date, time)):
            value = iso(value)
        out[name] = value
    return out


def changed(before: dict, after: dict) -> tuple[dict, dict]:
    """Only the keys whose value differs, as (old, new)."""
    keys = [k for k in after if before.get(k) != after.get(k)]
    return {k: before.get(k) for k in keys}, {k: after.get(k) for k in keys}
