"""Incremental pull: the changes a device hasn't seen yet, after a server cursor.

The cursor is sync_changes.id, a sequence assigned by the server (device clocks never order anything).
Within one page, an entity changed several times is sent once, with its current state.

Sequence values are assigned when a change is flushed but become visible when its transaction commits,
so a slow transaction can commit a LOWER id after a reader has already seen a higher one. To never skip
such a change, the cursor handed back only moves over the leading run of changes older than
SYNC_SETTLE_SECONDS; younger ones are sent now AND again on the next pull (re-applying a current state is
harmless).
"""
import datetime
import logging
import os

from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import iso
from models.sync import SyncChange
from services.sync import serializers

logger = logging.getLogger("milkflow.sync")

MAX_PAGE = 1000


def settle_seconds() -> int:
    return int(os.getenv("SYNC_SETTLE_SECONDS", "10"))


def latest_cursor(db: Session, principal: Principal) -> int:
    query = db.query(SyncChange.id)
    if not principal.is_superadmin:
        query = query.filter(SyncChange.cooperative_id == principal.cooperative_id)
    row = query.order_by(SyncChange.id.desc()).first()
    return row[0] if row else 0


def pull(db: Session, principal: Principal, cursor: int, limit: int = 500) -> dict:
    limit = max(1, min(limit, MAX_PAGE))
    types = serializers.ROLE_TYPES.get(principal.role, frozenset())
    query = db.query(SyncChange).filter(SyncChange.id > cursor, SyncChange.entity_type.in_(types))
    if not principal.is_superadmin:
        query = query.filter(SyncChange.cooperative_id == principal.cooperative_id)
    rows = query.order_by(SyncChange.id).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    latest: dict[tuple[str, str], int] = {}
    for row in rows:
        latest[(row.entity_type, row.entity_id)] = row.id
    by_type: dict[str, list[str]] = {}
    for entity_type, entity_id in latest:
        by_type.setdefault(entity_type, []).append(entity_id)
    data: dict[tuple[str, str], object] = {}
    for entity_type, ids in by_type.items():
        for entity_id, value in serializers.SERIALIZERS[entity_type](db, principal, ids).items():
            data[(entity_type, entity_id)] = value

    changes = []
    for (entity_type, entity_id), seq in sorted(latest.items(), key=lambda item: item[1]):
        value = data.get((entity_type, entity_id), serializers.MISSING)
        if value is serializers.SKIP:
            continue
        if value is serializers.MISSING:
            changes.append({"seq": seq, "entity_type": entity_type, "entity_id": entity_id, "op": "delete", "data": None})
        else:
            changes.append({"seq": seq, "entity_type": entity_type, "entity_id": entity_id, "op": "upsert", "data": value})

    # Advance only over the settled prefix: an unseen lower id may still be committing behind a young row.
    now = datetime.datetime.utcnow()
    settle_after = now - datetime.timedelta(seconds=settle_seconds())
    next_cursor = cursor
    for row in rows:
        if row.changed_at > settle_after:
            has_more = False  # the rest is recent too; it comes with the next pull
            break
        next_cursor = row.id

    logger.info(
        "sync_pull user=%s coop=%s cursor=%s next=%s changes=%s has_more=%s",
        principal.user.id, principal.cooperative_id, cursor, next_cursor, len(changes), has_more,
    )
    return {
        "changes": changes, "cursor": next_cursor, "has_more": has_more, "server_time": iso(now),
        "window": serializers.window(),
    }
