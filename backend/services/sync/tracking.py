"""Change log for offline sync.

Every ORM flush that inserts or changes a synchronised entity appends a row to `sync_changes` in the same
transaction (so a rolled-back change never appears) and bumps the entity's `sync_version`. This covers
every code path - the cooperative workspace, the superadmin console and sync pushes alike - without each
service having to remember to do it.

Bulk `query.update()` statements bypass the ORM and therefore this log; the services don't use them for
synchronised tables, and new code must not either.
"""
import datetime
import uuid
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class Tracked:
    entity_type: str
    cooperative_of: Callable[[object], Optional[uuid.UUID]]
    # Attribute changes that don't matter to devices (e.g. a login timestamp).
    ignored: frozenset = frozenset({"updated_at"})
    include: Callable[[object], bool] = lambda obj: True
    # Other entities whose serialised form embeds this one (a collector shows its user's name).
    related: Optional[Callable[[Session, object], Iterable[tuple[str, uuid.UUID, uuid.UUID]]]] = None


_REGISTRY: dict[type, Tracked] = {}
_installed = False


def _team_roles() -> set[str]:
    return {"COOP_ADMIN", "MANAGER", "COLLECTOR"}


def _role(user) -> str:
    role = user.role
    return role.value if hasattr(role, "value") else str(role or "")


def _user_related(session: Session, user) -> Iterable[tuple[str, uuid.UUID, uuid.UUID]]:
    from models.operations import Collector

    with session.no_autoflush:
        profile = session.query(Collector).filter(Collector.user_id == user.id).first()
    if profile is not None:
        yield "collector", profile.id, profile.cooperative_id


def _registry() -> dict[type, Tracked]:
    if _REGISTRY:
        return _REGISTRY
    from models.admin import Cooler
    from models.centre import CollectionCentre
    from models.cooperative import Cooperative
    from models.farmer import Farmer
    from models.notifications import Notification
    from models.operations import Collector, MilkCollection
    from models.sensors import CoolerReading, SensorDevice
    from models.user import User

    by_coop = lambda obj: obj.cooperative_id  # noqa: E731
    _REGISTRY.update({
        Cooperative: Tracked("cooperative", lambda obj: obj.id),
        Farmer: Tracked("farmer", by_coop),
        CollectionCentre: Tracked("centre", by_coop),
        Cooler: Tracked("cooler", by_coop),
        Collector: Tracked("collector", by_coop),
        MilkCollection: Tracked("collection", by_coop),
        CoolerReading: Tracked("cooler_reading", by_coop),
        SensorDevice: Tracked("sensor", by_coop),
        Notification: Tracked("notification", by_coop),
        User: Tracked(
            "team_member", by_coop,
            ignored=frozenset({"updated_at", "last_login_at", "password_hash"}),
            include=lambda user: _role(user) in _team_roles(),
            related=_user_related,
        ),
    })
    return _REGISTRY


def _meaningfully_changed(obj, spec: Tracked) -> bool:
    state = inspect(obj)
    for attr in state.mapper.column_attrs:
        if attr.key in spec.ignored or attr.key == "sync_version":
            continue
        if state.attrs[attr.key].history.has_changes():
            return True
    return False


def _before_flush(session: Session, _flush_context, _instances) -> None:
    from models.sync import SyncChange

    registry = _registry()
    now = datetime.datetime.utcnow()
    seen: set[tuple[str, str]] = set()

    def log(entity_type: str, entity_id, cooperative_id) -> None:
        key = (entity_type, str(entity_id))
        if key in seen:
            return
        seen.add(key)
        session.add(SyncChange(
            cooperative_id=cooperative_id, entity_type=entity_type, entity_id=str(entity_id), changed_at=now,
        ))

    for obj in list(session.new) + list(session.dirty):
        spec = registry.get(type(obj))
        if spec is None:
            continue
        is_new = obj in session.new
        if not is_new and not _meaningfully_changed(obj, spec):
            continue
        if not is_new and hasattr(obj, "sync_version"):
            obj.sync_version = (obj.sync_version or 0) + 1
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()  # the change row needs the id before the INSERT assigns it
        if not spec.include(obj):
            continue
        cooperative_id = spec.cooperative_of(obj)
        if cooperative_id is None:
            continue
        log(spec.entity_type, obj.id, cooperative_id)
        if spec.related is not None and not is_new:
            for entity_type, entity_id, coop_id in spec.related(session, obj):
                log(entity_type, entity_id, coop_id)


def install() -> None:
    """Attach the listener to every Session (idempotent)."""
    global _installed
    if not _installed:
        event.listen(Session, "before_flush", _before_flush)
        _installed = True


def log_change(session: Session, entity_type: str, entity_id, cooperative_id) -> None:
    """Record a change made outside the ORM unit of work (e.g. an atomic UPDATE statement)."""
    from models.sync import SyncChange

    session.add(SyncChange(
        cooperative_id=cooperative_id, entity_type=entity_type, entity_id=str(entity_id),
        changed_at=datetime.datetime.utcnow(),
    ))
