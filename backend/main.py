import datetime
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401  (registers every table on Base.metadata)
from routers import auth, batches, collections, cooperative, devices, finance, inbox, reports, superadmin, sync, workspace

# The schema is managed by Alembic (`alembic upgrade head`), never created at startup.

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(
    title="MilkOS API",
    description=(
        "MilkOS is offline-first: devices keep a local copy of their cooperative's data and a queue of changes, "
        "and synchronise through /api/v1/sync (push, pull, status). See the Offline sync and Devices sections."
    ),
)

# Explicit origins are required when allow_credentials=True.
# Comma-separated; override with CORS_ORIGINS in backend/.env for any non-local deployment.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
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


@app.get("/api/v1/health", tags=["Health"])
def health():
    """Unauthenticated liveness check used by devices to tell 'no network' from 'server unreachable'."""
    return {"status": "ok", "server_time": datetime.datetime.utcnow().isoformat() + "Z"}
