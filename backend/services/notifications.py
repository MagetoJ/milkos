"""Notification records and SMS delivery (cooler alerts and collection receipts).

Delivery always runs AFTER the change that caused it (a cooler reading, a confirmed collection) has been
committed, one notification per transaction, so an SMS problem can never undo or fail that change.

Lifecycle of one SMS (models.notifications.NotificationStatus):

    PENDING --no provider configured--> PENDING_PROVIDER (kept, retried; never reported as sent)
       |--not enough credits---------> FAILED (retried with backoff)
       '--credit reserved--> RESERVED --> SENDING --provider accepted--> SENT     (credit CONSUMED)
                                             '--provider refused-----> FAILED   (credit REFUNDED, retried)
                                                                       REFUNDED (credit REFUNDED, given up)

Credits come from the SMS credit ledger (services/sms_credits.py): one RESERVED entry per attempt, settled
by exactly one CONSUMED or REFUNDED entry, so a retry or a crash can never double-charge.
"""
import datetime
import logging
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from core.utils import iso
from models.notifications import Notification, NotificationStatus
from services import audit, sms, sms_credits

logger = logging.getLogger("milkflow.notifications")

MAX_ATTEMPTS = 5
NOT_CONFIGURED = "SMS provider not configured"
STUCK_AFTER = datetime.timedelta(minutes=10)


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
        "collection_id": str(n.collection_id) if n.collection_id else None,
        "farmer_id": str(n.farmer_id) if n.farmer_id else None,
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


def _fail(n: Notification, error: str, retryable: bool, now: datetime.datetime) -> None:
    n.status = NotificationStatus.FAILED
    n.error = error[:1000]
    n.failed_at = now
    n.next_attempt_at = now + _backoff(n.attempts) if retryable and n.attempts < MAX_ATTEMPTS else None


def deliver(db: Session, notification: Notification, actor=None) -> Notification:
    """Try to send one notification now. Commits; never raises for delivery problems."""
    n = notification
    if n.status in (NotificationStatus.SENT, NotificationStatus.SKIPPED, NotificationStatus.REFUNDED):
        return n
    now = datetime.datetime.utcnow()
    n.attempts = (n.attempts or 0) + 1

    try:
        provider = sms.get_provider()
    except sms.SmsProviderError as exc:
        provider = None
        logger.error("sms_provider_misconfigured error=%s", exc)
    if provider is None:
        n.status = NotificationStatus.PENDING_PROVIDER
        n.error = NOT_CONFIGURED
        n.failed_at = now
        n.next_attempt_at = now + _backoff(n.attempts) if n.attempts < MAX_ATTEMPTS else None
    elif n.channel != "SMS":
        _fail(n, f"Unsupported channel {n.channel}", retryable=False, now=now)
    else:
        reference = sms_credits.next_reference(db, n.cooperative_id, f"sms:{n.id}:")
        if not sms_credits.reserve(db, n.cooperative_id, reference):
            _fail(n, "Not enough SMS credits. Top up to deliver SMS.", retryable=True, now=now)
        else:
            # The reservation and the hand-over are committed before the provider is called, so a crash
            # mid-send leaves a visible SENDING record (see recover_stuck) and never a lost credit.
            n.status = NotificationStatus.RESERVED
            n.provider = provider.name
            db.commit()
            n.status = NotificationStatus.SENDING
            db.commit()
            try:
                result = provider.send_sms(n.recipient_phone, n.message)
            except Exception as exc:  # a provider bug must not break the caller
                logger.exception("sms_provider_crashed provider=%s", provider.name)
                result = sms.SmsResult(False, error=f"Provider error: {type(exc).__name__}")
            now = datetime.datetime.utcnow()
            if result.accepted:
                sms_credits.consume(db, n.cooperative_id, reference)
                n.status = NotificationStatus.SENT
                n.sent_at = now
                n.provider_message_id = result.provider_message_id
                n.error = None
                n.next_attempt_at = None
            else:
                sms_credits.refund(db, n.cooperative_id, reference, reason=f"SMS not accepted: {result.error or 'refused'}"[:200])
                _fail(n, result.error or "Provider refused the message", result.retryable, now)
                if n.next_attempt_at is None:
                    n.status = NotificationStatus.REFUNDED  # final: given up, the credit went back

    sent = n.status == NotificationStatus.SENT
    logger.info(
        "sms_%s notification=%s type=%s to=%s attempt=%s provider=%s%s",
        "sent" if sent else n.status.lower(), n.id, n.type, mask_phone(n.recipient_phone), n.attempts,
        n.provider or "-", "" if sent else f" error={n.error!r}",
    )
    if actor is not None:
        audit.record(
            db, actor, "NOTIFICATION_SENT" if sent else "NOTIFICATION_FAILED",
            target=f"{n.type} SMS to {mask_phone(n.recipient_phone)}" + ("" if sent else f": {n.error}"),
            entity_type="notification", entity_id=n.id, cooperative_id=n.cooperative_id,
            new_values={"status": n.status, "attempts": n.attempts, "provider": n.provider},
        )
    if not sent and n.next_attempt_at is None and n.status in (NotificationStatus.FAILED, NotificationStatus.REFUNDED):
        _tell_staff(db, n)
    db.commit()
    return n


def _tell_staff(db: Session, n: Notification) -> None:
    """In-app alert when an SMS has finally failed (no automatic retry left)."""
    from services import inbox

    inbox.notify(
        db, cooperative_id=n.cooperative_id, roles=("COOP_ADMIN", "MANAGER"), category="SMS", type="SMS_FAILED",
        severity="WARNING", title=f"SMS to {mask_phone(n.recipient_phone)} could not be delivered",
        body=f"{n.type.replace('_', ' ').title()}: {n.error}", entity_type="notification", entity_id=n.id,
        link="/cooperatives/sms-credits",
    )


def recover_stuck(db: Session, cooperative_id: Optional[UUID]) -> int:
    """Attempts interrupted between reserving a credit and the provider's answer. The outcome is unknown, so
    the credit is refunded and the SMS is NOT resent automatically (that could duplicate it); staff may retry."""
    cutoff = datetime.datetime.utcnow() - STUCK_AFTER
    query = db.query(Notification).filter(
        Notification.status.in_((NotificationStatus.RESERVED, NotificationStatus.SENDING)), Notification.updated_at < cutoff,
    )
    if cooperative_id is not None:
        query = query.filter(Notification.cooperative_id == cooperative_id)
    count = 0
    for n in query.limit(50).all():
        for reference in sms_credits.open_reservations(db, n.cooperative_id, f"sms:{n.id}:"):
            sms_credits.refund(db, n.cooperative_id, reference, reason="Send interrupted; outcome unknown")
        n.status = NotificationStatus.FAILED
        n.error = "Sending was interrupted and its outcome is unknown. Retry if the recipient did not receive it."
        n.failed_at = datetime.datetime.utcnow()
        n.next_attempt_at = None
        count += 1
    if count:
        db.commit()
    return count


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
    recover_stuck(db, cooperative_id)
    query = db.query(Notification).filter(
        (Notification.status.in_((NotificationStatus.FAILED, NotificationStatus.PENDING_PROVIDER))
         & (Notification.next_attempt_at <= now))
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
    """Manual retry by staff (FAILED, REFUNDED or PENDING_PROVIDER), resetting the attempt budget."""
    if notification.status not in (NotificationStatus.FAILED, NotificationStatus.REFUNDED, NotificationStatus.PENDING_PROVIDER):
        return notification
    notification.status = NotificationStatus.FAILED
    notification.attempts = 0
    return deliver(db, notification, actor)
