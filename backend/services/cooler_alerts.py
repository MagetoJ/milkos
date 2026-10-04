"""Cooler alert rules and who is told.

Recipients are always resolved here, from the server's own data - never from the device or sensor:
    cooler -> manager in charge (cooler.manager_user_id, else the centre's manager)
           -> cooperative -> its active COOP_ADMIN accounts
           (only when cooperatives.alert_sms_enabled and coolers.alerts_enabled)

Rules (a threshold left empty switches that rule off):
    LOW_VOLUME                 reading below coolers.low_volume_alert_litres
    HIGH_VOLUME                reading above coolers.high_volume_alert_litres
    TEMPERATURE_OUT_OF_RANGE   reading outside min/max_temperature_c
    LOW_BATTERY                sensor battery below coolers.low_battery_percent
    STALE_READING              no reading for coolers.stale_after_minutes   (evaluate_staleness)
    SENSOR_DISCONNECTED        a device reported the bound sensor disconnected (sensor_disconnected)

The same alert for the same cooler is not repeated within ALERT_COOLDOWN_MINUTES (default 60).
Suspicious readings raise no alerts; simulated readings produce SKIPPED notifications (never sent).
"""
import datetime
import os
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from core.utils import num
from models.admin import Cooler, CoolerStatus
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from models.sensors import CoolerReading, ReadingQuality
from models.user import User
from schemas.auth import UserRole


def _cooldown() -> datetime.timedelta:
    return datetime.timedelta(minutes=int(os.getenv("ALERT_COOLDOWN_MINUTES", "60")))


def _local(ts: datetime.datetime) -> str:
    """Wall-clock time for the message (Kenya by default: ALERT_UTC_OFFSET_HOURS=3)."""
    offset = float(os.getenv("ALERT_UTC_OFFSET_HOURS", "3"))
    return (ts + datetime.timedelta(hours=offset)).strftime("%d %b %Y %I:%M %p").replace(" 0", " ")


def _litres(value: Optional[float]) -> str:
    return f"{value:,.0f} L" if value is not None else "unknown"


@dataclass
class Alert:
    type: str
    severity: str
    headline: str
    threshold: Optional[float] = None


@dataclass
class Recipient:
    user_id: object
    phone: str
    name: str


def recipients(db: Session, cooler: Cooler) -> tuple[list[Recipient], Optional[User], Optional[CollectionCentre]]:
    centre = db.get(CollectionCentre, cooler.centre_id) if cooler.centre_id else None
    manager_id = cooler.manager_user_id or (centre.manager_user_id if centre else None)
    manager = db.get(User, manager_id) if manager_id else None
    if manager is not None and (manager.cooperative_id != cooler.cooperative_id or not manager.is_active):
        manager = None

    people: list[User] = (
        db.query(User)
        .filter(User.cooperative_id == cooler.cooperative_id, User.role == UserRole.COOP_ADMIN, User.is_active.is_(True))
        .order_by(User.created_at)
        .all()
    )
    if manager is not None:
        people.append(manager)
    seen: set[str] = set()
    out = []
    for person in people:
        if person.phone_number and person.phone_number not in seen:
            seen.add(person.phone_number)
            out.append(Recipient(person.id, person.phone_number, person.full_name))
    return out, manager, centre


def reading_alerts(cooler: Cooler, reading: CoolerReading) -> list[Alert]:
    alerts: list[Alert] = []
    volume, temp = num(reading.volume_litres), num(reading.temperature_celsius)
    low, high = num(cooler.low_volume_alert_litres), num(cooler.high_volume_alert_litres)
    capacity = num(cooler.capacity_litres)
    if volume is not None and low is not None and volume < low:
        alerts.append(Alert("LOW_VOLUME", "WARNING", f"Warning: Volume below configured threshold ({_litres(low)}).", low))
    if volume is not None and high is not None and volume > high:
        severity = "CRITICAL" if capacity is not None and volume >= capacity else "WARNING"
        alerts.append(Alert("HIGH_VOLUME", severity, f"Warning: Volume above configured threshold ({_litres(high)}).", high))
    tmin, tmax = num(cooler.min_temperature_c), num(cooler.max_temperature_c)
    if temp is not None and ((tmin is not None and temp < tmin) or (tmax is not None and temp > tmax)):
        limit = tmax if tmax is not None and temp > tmax else tmin
        alerts.append(Alert(
            "TEMPERATURE_OUT_OF_RANGE", "CRITICAL",
            f"Warning: Temperature {temp:g}°C is outside the allowed range "
            f"({'' if tmin is None else f'{tmin:g}'}–{'' if tmax is None else f'{tmax:g}'}°C).", limit,
        ))
    if reading.battery_percent is not None and cooler.low_battery_percent is not None \
            and reading.battery_percent < cooler.low_battery_percent:
        alerts.append(Alert(
            "LOW_BATTERY", "INFO", f"Sensor battery low: {reading.battery_percent}% (threshold {cooler.low_battery_percent}%).",
            cooler.low_battery_percent,
        ))
    return alerts


def _recently_alerted(db: Session, cooler: Cooler, alert_type: str, now: datetime.datetime) -> bool:
    return db.query(Notification.id).filter(
        Notification.cooler_id == cooler.id, Notification.type == alert_type,
        Notification.status != NotificationStatus.SKIPPED, Notification.created_at >= now - _cooldown(),
    ).first() is not None


def _message(cooler: Cooler, centre, manager, volume: Optional[float], headline: str, at: datetime.datetime) -> str:
    lines = ["MilkOS Cooler Alert", "", cooler.name]
    location = centre.name if centre else cooler.location
    if location:
        lines.append(f"Location: {location}")
    if manager is not None:
        lines.append(f"Manager: {manager.full_name}")
    lines += ["", f"Current milk volume: {_litres(volume)}", "", headline, "", f"Time: {_local(at)}"]
    return "\n".join(lines)


def _create(
    db: Session, cooler: Cooler, alert: Alert, *, reading: Optional[CoolerReading], at: datetime.datetime,
    skip_reason: Optional[str] = None,
) -> list[Notification]:
    cooperative = db.get(Cooperative, cooler.cooperative_id)
    if not cooler.alerts_enabled or not cooperative.alert_sms_enabled:
        return []
    now = datetime.datetime.utcnow()
    if skip_reason is None and _recently_alerted(db, cooler, alert.type, now):
        return []
    people, manager, centre = recipients(db, cooler)
    volume = num(reading.volume_litres) if reading is not None else num(cooler.current_volume_litres)
    message = _message(cooler, centre, manager, volume, alert.headline, at)
    context = {
        "cooperative": {"id": str(cooperative.id), "name": cooperative.name},
        "cooler": {"id": str(cooler.id), "name": cooler.name, "code": cooler.code},
        "location": centre.name if centre else cooler.location,
        "manager": manager.full_name if manager else None,
        "reading": None if reading is None else {
            "id": str(reading.id), "volume_litres": num(reading.volume_litres),
            "temperature_celsius": num(reading.temperature_celsius), "battery_percent": reading.battery_percent,
            "measured_at": reading.measured_at.isoformat() + "Z", "source": reading.source,
        },
        "threshold": alert.threshold,
        "timestamp": at.isoformat() + "Z",
        "severity": alert.severity,
    }
    out = []
    for person in people:
        n = Notification(
            cooperative_id=cooler.cooperative_id, cooler_id=cooler.id, reading_id=reading.id if reading else None,
            recipient_user_id=person.user_id, recipient_phone=person.phone, channel="SMS", type=alert.type,
            severity=alert.severity, message=message, context=context,
            status=NotificationStatus.SKIPPED if skip_reason else NotificationStatus.PENDING,
            error=skip_reason, attempts=0,
        )
        db.add(n)
        out.append(n)
    return out


def evaluate_reading(db: Session, cooler: Cooler, reading: CoolerReading) -> list[Notification]:
    """Notifications (not yet delivered, not committed) for one stored reading."""
    if reading.quality == ReadingQuality.SUSPICIOUS or cooler.status != CoolerStatus.ACTIVE:
        return []
    skip = "Simulated reading - not sent." if reading.quality == ReadingQuality.SIMULATED else None
    out: list[Notification] = []
    for alert in reading_alerts(cooler, reading):
        out += _create(db, cooler, alert, reading=reading, at=reading.measured_at, skip_reason=skip)
    return out


def sensor_disconnected(db: Session, cooler: Cooler, at: datetime.datetime, sensor_name: str) -> list[Notification]:
    alert = Alert("SENSOR_DISCONNECTED", "WARNING", f"Warning: Sensor {sensor_name} disconnected.")
    return _create(db, cooler, alert, reading=None, at=at)


def evaluate_staleness(db: Session, cooperative_id) -> list[Notification]:
    """STALE_READING for every active cooler whose last reading is older than its configured limit."""
    now = datetime.datetime.utcnow()
    out: list[Notification] = []
    coolers = db.query(Cooler).filter(
        Cooler.cooperative_id == cooperative_id, Cooler.status == CoolerStatus.ACTIVE,
        Cooler.stale_after_minutes.isnot(None), Cooler.last_reading_at.isnot(None),
    ).all()
    for cooler in coolers:
        if cooler.last_reading_at < now - datetime.timedelta(minutes=cooler.stale_after_minutes):
            minutes = int((now - cooler.last_reading_at).total_seconds() // 60)
            alert = Alert(
                "STALE_READING", "WARNING",
                f"Warning: No reading for {minutes} minutes (limit {cooler.stale_after_minutes}).",
                cooler.stale_after_minutes,
            )
            out += _create(db, cooler, alert, reading=None, at=now)
    return out
