"""SMS receipts for confirmed collections: one SMS to each farmer whose milk was allocated in a batch.

Receipts are created in the same transaction as the batch (status PENDING) and delivered after it commits
through services/notifications.py, so they follow the same credit and provider rules as every SMS:
reported SENT only when the provider accepted it. Each receipt has the idempotency key
"receipt:<allocation line id>", so a batch resent after a reconnection can never produce a second receipt.
"""
import os
from typing import Optional

from sqlalchemy.orm import Session

from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.notifications import Notification, NotificationStatus
from models.operations import CollectionBatch, MilkCollection
from services import settings

DEFAULT_TEMPLATE = "MilkOS:\nCollection received: {kg} KG\nCentre: {centre}\nDate: {date}\nCollection Ref: {reference}"


def _date(batch: CollectionBatch) -> str:
    return batch.collection_date.strftime("%d/%m/%Y")


def message(db: Session, template: Optional[str], *, cooperative: Cooperative, batch: CollectionBatch,
            line: MilkCollection, farmer) -> str:
    centre = db.get(CollectionCentre, batch.centre_id) if batch.centre_id else None
    cooler = db.get(Cooler, batch.cooler_id) if batch.cooler_id else None
    values = {
        "kg": f"{line.quantity_kg:.2f}",
        "farmer": farmer.full_name,
        "centre": centre.name if centre else (cooler.name if cooler else cooperative.name),
        "cooler": cooler.name if cooler else "-",
        "date": _date(batch),
        "reference": line.reference,
        "cooperative": cooperative.name,
    }
    try:
        return (template or DEFAULT_TEMPLATE).format(**values)
    except (KeyError, IndexError, ValueError):
        return DEFAULT_TEMPLATE.format(**values)


def enabled(cooperative: Cooperative, batch: CollectionBatch) -> bool:
    return bool(cooperative.receipt_sms_enabled) and bool(batch.send_receipts) and \
        os.getenv("RECEIPT_SMS_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}


def create_for_batch(db: Session, cooperative: Cooperative, batch: CollectionBatch, lines: list[MilkCollection],
                     farmers: dict) -> list[Notification]:
    """PENDING receipt notifications for a just-confirmed batch (added to the session, not committed)."""
    if not enabled(cooperative, batch):
        return []
    template = settings.get(db, "sms.receipt_template")
    out = []
    for line in lines:
        farmer = farmers.get(line.farmer_id)
        if farmer is None or not farmer.phone:
            continue
        key = f"receipt:{line.id}"
        if db.query(Notification.id).filter(Notification.idempotency_key == key).first():
            continue
        n = Notification(
            cooperative_id=cooperative.id, cooler_id=batch.cooler_id, collection_id=line.id, farmer_id=farmer.id,
            recipient_phone=farmer.phone, channel="SMS", type="COLLECTION_RECEIPT", severity="INFO",
            message=message(db, template, cooperative=cooperative, batch=batch, line=line, farmer=farmer),
            context={
                "batch": {"id": str(batch.id), "reference": batch.reference},
                "collection": {"id": str(line.id), "reference": line.reference, "quantity_kg": float(line.quantity_kg)},
                "farmer": {"id": str(farmer.id), "number": farmer.farmer_number},
            },
            status=NotificationStatus.PENDING, attempts=0, idempotency_key=key,
        )
        db.add(n)
        out.append(n)
    if out:
        db.flush()
    return out
