"""The ASGI application: `uvicorn app.main:app`. See app/README.md for how the backend is layered."""
import datetime
import logging

from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.routers import (
    account, auth, batches, collections, cooperative, devices, farmer, finance, inbox, reports, superadmin, sync,
    workspace,
)
from app.core import config
from app.core.middleware import install_middleware
from app.infrastructure.db import models  # noqa: F401  (registers every table on Base.metadata)

# The schema is managed by Alembic (`alembic upgrade head`), never created at startup.

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(
    title="MilkOS API",
    description=(
        "MilkOS is offline-first: devices keep a local copy of their cooperative's data and a queue of changes, "
        "and synchronise through /api/v1/sync (push, pull, status). See the Offline sync and Devices sections."
    ),
)

install_middleware(app)
register_error_handlers(app)

app.include_router(auth.router)
app.include_router(account.router)
app.include_router(superadmin.router)
app.include_router(cooperative.router)
app.include_router(collections.router)
app.include_router(devices.router)
app.include_router(sync.router)
app.include_router(batches.router)
app.include_router(batches.requests_router)
app.include_router(finance.router)
app.include_router(inbox.router)
app.include_router(reports.router)
app.include_router(workspace.router)
app.include_router(farmer.router)


@app.get("/api/v1/health", tags=["Health"])
def health():
    """Unauthenticated liveness check used by devices to tell 'no network' from 'server unreachable'."""
    return {"status": "ok", "server_time": datetime.datetime.utcnow().isoformat() + "Z"}
