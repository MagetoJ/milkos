# Importing any model imports them all, so every table (and every ForeignKey target)
# is registered on Base.metadata. Alembic's env.py relies on this too.
from models import (  # noqa: F401
    cooperative, user, admin, centre, farmer, membership, operations, sync, sensors, notifications, finance, inbox,
)
from services import immutability as _immutability
from services.sync import tracking as _sync_tracking

# Every flush appends to the sync change log (see services/sync/tracking.py).
_sync_tracking.install()
# Confirmed collection batches and lines are never overwritten in place (see services/immutability.py).
_immutability.install()
