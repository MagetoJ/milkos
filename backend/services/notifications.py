"""Notification records and SMS delivery.

Delivery always runs AFTER the change that caused it (a cooler reading) has been committed, one
notification per transaction, so an SMS problem can never undo or fail the reading. A notification is
marked SENT only once the provider has accepted it; otherwise it is FAILED with the reason and retried
with exponential backoff while attempts remain.

Each SMS sent costs the cooperative one SMS credit (cooperatives.sms_credit_balance, topped up through
the existing SMS credit payments). The credit is reserved before sending and refunded if the provider
refuses, so the balance never goes negative.
"""
import datetime
import logging
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from core.utils import iso
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from services import audit, sms
from services.sync import tracking

logger = logging.getLogger("milkflow.notifications")

MAX_ATTEMPTS = 5
NOT_CONFIGURED = "SMS provider not configured"


def mask_phone(phone: Optional[str]) -> str:
    if not phone or len(phone) < 8:
        return "****"
    return f"{phone[:5]}{'*' * (len(phone) - 8)}{phone[-3:]}"


def notification_json(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "cooperative_id": str(n.cooperative_id),
        "cooler_id": str(n.cooler_id) if n.cooler_id else None,
        "reading_id": str(n.reading_id) if n.reading_id else None,
        "recipient_user_id": str(n.recipient_user_id) if n.recipient_user_id else None,
        "recipient_phone": n.recipient_phone,
        "channel": n.channel,
        "type": n.type,
        "severity": n.severity,
        "message": n.message,
        "context": n.context,
        "status": n.status,
        "provider": n.provider,
        "provider_message_id": n.provider_message_id,
        "attempts": n.attempts,
        "next_attempt_at": iso(n.next_attempt_at),
        "error": n.error,
        "created_at": iso(n.created_at),
        "sent_at": iso(n.sent_at),
        "failed_at": iso(n.failed_at),
    }


def _backoff(attempts: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=min(2 ** max(attempts - 1, 0), 60))


def _reserve_credit(db: Session, cooperative_id: UUID) -> bool:
    result = db.execute(
        update(Cooperative)
        .where(Cooperative.id == cooperative_id, Cooperative.sms_credit_balance >= 1)
        .values(sms_credit_balance=Cooperative.sms_credit_balance - 1)
    )
    return result.rowcount == 1


def _refund_credit(db: Session, cooperative_id: UUID) -> None:
    db.execute(
        update(Cooperative).where(Cooperative.id == cooperative_id)
        .values(sms_credit_balance=Cooperative.sms_credit_balance + 1)
    )


def _fail(n: Notification, error: str, retryable: bool, now: datetime.datetime) -> None:
    n.status = NotificationStatus.FAILED
    n.error = error[:1000]
    n.failed_at = now
    n.next_attempt_at = now + _backoff(n.attempts) if retryable and n.attempts < MAX_ATTEMPTS else None


def deliver(db: Session, notification: Notification, actor=None) -> Notification:
    """Try to send one notification now. Commits; never raises for delivery problems."""
    n = notification
    if n.status in (NotificationStatus.SENT, NotificationStatus.SKIPPED):
        return n
    now = datetime.datetime.utcnow()
    n.attempts = (n.attempts or 0) + 1

    try:
        provider = sms.get_provider()
    except sms.SmsProviderError as exc:
        provider = None
        logger.error("sms_provider_misconfigured error=%s", exc)
    if provider is None:
        _fail(n, NOT_CONFIGURED, retryable=True, now=now)
    elif n.channel != "SMS":
        _fail(n, f"Unsupported channel {n.channel}", retryable=False, now=now)
    elif not _reserve_credit(db, n.cooperative_id):
        _fail(n, "Not enough SMS credits. Top up to deliver cooler alerts.", retryable=True, now=now)
    else:
        n.provider = provider.name
        try:
            result = provider.send_sms(n.recipient_phone, n.message)
        except Exception as exc:  # a provider bug must not break the caller
            logger.exception("sms_provider_crashed provider=%s", provider.name)
            result = sms.SmsResult(False, error=f"Provider error: {type(exc).__name__}")
        if result.accepted:
            tracking.log_change(db, "cooperative", n.cooperative_id, n.cooperative_id)  # credit balance changed
            n.status = NotificationStatus.SENT
            n.sent_at = now
            n.provider_message_id = result.provider_message_id
            n.error = None
            n.next_attempt_at = None
        else:
            _refund_credit(db, n.cooperative_id)
            _fail(n, result.error or "Provider refused the message", result.retryable, now)

    sent = n.status == NotificationStatus.SENT
    logger.info(
        "sms_%s notification=%s type=%s to=%s attempt=%s provider=%s%s",
        "sent" if sent else "failed", n.id, n.type, mask_phone(n.recipient_phone), n.attempts,
        n.provider or "-", "" if sent else f" error={n.error!r}",
    )
    if actor is not None:
        audit.record(
            db, actor, "NOTIFICATION_SENT" if sent else "NOTIFICATION_FAILED",
            target=f"{n.type} SMS to {mask_phone(n.recipient_phone)}" + ("" if sent else f": {n.error}"),
            entity_type="notification", entity_id=n.id, cooperative_id=n.cooperative_id,
            new_values={"status": n.status, "attempts": n.attempts, "provider": n.provider},
        )
    db.commit()
    return n


def dispatch(db: Session, notification_ids: Iterable[UUID], actor=None) -> list[Notification]:
    out = []
    for nid in notification_ids:
        n = db.get(Notification, nid)
        if n is not None and n.status == NotificationStatus.PENDING:
            try:
                out.append(deliver(db, n, actor))
            except Exception:  # keep going; the notification stays PENDING and is retried later
                db.rollback()
                logger.exception("notification_dispatch_failed notification=%s", nid)
    return out


def dispatch_due(db: Session, cooperative_id: Optional[UUID], actor=None, limit: int = 20) -> list[Notification]:
    """Retry failed notifications whose backoff has elapsed (and any left PENDING)."""
    now = datetime.datetime.utcnow()
    query = db.query(Notification).filter(
        ((Notification.status == NotificationStatus.FAILED) & (Notification.next_attempt_at <= now))
        | ((Notification.status == NotificationStatus.PENDING) & (Notification.created_at <= now - datetime.timedelta(minutes=1)))
    )
    if cooperative_id is not None:
        query = query.filter(Notification.cooperative_id == cooperative_id)
    out = []
    for n in query.order_by(Notification.created_at).limit(limit).all():
        try:
            out.append(deliver(db, n, actor))
        except Exception:
            db.rollback()
            logger.exception("notification_retry_failed notification=%s", n.id)
    return out


def retry(db: Session, actor, notification: Notification) -> Notification:
    """Manual retry by staff: allowed for FAILED notifications, resets the attempt budget."""
    if notification.status != NotificationStatus.FAILED:
        return notification
    notification.attempts = 0
    return deliver(db, notification, actor)
