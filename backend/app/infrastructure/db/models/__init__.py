# isort: skip_file
# Importing any model imports them all, so every table (and every ForeignKey target)
# is registered on Base.metadata. Alembic's env.py relies on this too.
from app.infrastructure.db.models import (  # noqa: F401
    cooperative, user, admin, centre, farmer, membership, operations, sync, sensors, notifications, finance, inbox,
)
from app.infrastructure.db import change_log as _change_log, immutability as _immutability

# Every flush appends to the sync change log (see app/infrastructure/db/change_log.py).
_change_log.install()
# Confirmed collection batches and lines are never overwritten in place (see app/infrastructure/db/immutability.py).
_immutability.install()
