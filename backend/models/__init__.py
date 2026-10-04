# Importing any model imports them all, so every table (and every ForeignKey target)
# is registered on Base.metadata. Alembic's env.py relies on this too.
from models import (  # noqa: F401
    cooperative, user, admin, centre, farmer, membership, operations, sync, sensors, notifications,
)
from services.sync import tracking as _sync_tracking

# Every flush appends to the sync change log (see services/sync/tracking.py).
_sync_tracking.install()
