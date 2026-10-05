"""Guard against overwriting confirmed collection history, whatever code path tries it.

Installed on every Session (models/__init__.py). On flush, a persistent CollectionBatch or MilkCollection may
only change its lifecycle fields; deleting one through the ORM is refused too. The service layer already
refuses such edits with friendly errors - this is the backstop that makes "never silently overwritten" hold
for code written later as well.

    CollectionBatch   status, superseded_by_batch_id (set by corrections/reversals)
    MilkCollection    record_status; and the lab-result fields while its quality_status was PENDING
"""
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

ALWAYS = {"updated_at", "sync_version"}
BATCH_MUTABLE = ALWAYS | {"status", "superseded_by_batch_id"}
LINE_MUTABLE = ALWAYS | {"record_status"}
LAB_FIELDS = {"quality_status", "fat_percentage", "snf_percentage", "rejection_reason"}

_installed = False


class ImmutableRecordError(RuntimeError):
    """A confirmed collection record was about to be overwritten or deleted."""


def _changed(obj) -> set[str]:
    state = inspect(obj)
    return {attr.key for attr in state.mapper.column_attrs if state.attrs[attr.key].history.has_changes()}


def _check(session: Session, _flush_context, _instances) -> None:
    from models.operations import CollectionBatch, MilkCollection, QualityStatus

    for obj in session.deleted:
        if isinstance(obj, (CollectionBatch, MilkCollection)):
            raise ImmutableRecordError(f"{type(obj).__name__} {obj.id} can't be deleted; reverse it instead.")
    for obj in session.dirty:
        if obj in session.new or not isinstance(obj, (CollectionBatch, MilkCollection)):
            continue
        changed = _changed(obj)
        if isinstance(obj, CollectionBatch):
            illegal = changed - BATCH_MUTABLE
        else:
            allowed = set(LINE_MUTABLE)
            previous = inspect(obj).attrs["quality_status"].history
            was = previous.deleted[0] if previous.deleted else obj.quality_status
            if was == QualityStatus.PENDING:
                allowed |= LAB_FIELDS
            illegal = changed - allowed
        if illegal:
            raise ImmutableRecordError(
                f"{type(obj).__name__} {obj.id} is confirmed; {', '.join(sorted(illegal))} can't be changed in place."
            )


def install() -> None:
    global _installed
    if not _installed:
        event.listen(Session, "before_flush", _check)
        _installed = True
