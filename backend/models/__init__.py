# Importing any model imports them all, so every table (and every ForeignKey target)
# is registered on Base.metadata. Alembic's env.py relies on this too.
from models import cooperative, user, admin, centre, farmer, membership, operations  # noqa: F401
