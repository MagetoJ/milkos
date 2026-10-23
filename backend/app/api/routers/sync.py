"""Offline synchronisation API: /api/v1/sync. See app/domain/schemas/sync.py for the protocol.

Every request needs the caller's access token AND the X-Device-Id header of a device registered for
them (POST /api/v1/devices/register). The cooperative is taken from the caller's account in the
database, never from the request.

  COOP_ADMIN / MANAGER   push farmers, centres, collections (+ corrections), cooler readings, sensor events;
                         pull their cooperative's operational data
  COLLECTOR              push collections, cooler readings, sensor events; pull what they need to record milk
  SUPER_ADMIN            pull the cooperative directory only (cached, read-only); push is refused
  FARMER                 not offline-enabled
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import load_principal
from app.api.dependencies.db import get_db
from app.api.dependencies.tasks import get_tasks
from app.core.utils import iso
from app.domain.exceptions import NotFound, PermissionDenied
from app.domain.interfaces import TaskDispatcher
from app.domain.schemas.sync import ConflictResolution, PullResponse, PushRequest, PushResponse
from app.infrastructure.db.models.sync import DeviceSession
from app.services import background
from app.services.principal import Principal
from app.services.sync import devices, pull as pull_service, push as push_service

router = APIRouter(prefix="/api/v1/sync", tags=["Offline sync"])


class SyncCaller:
    def __init__(self, principal: Principal, device, session: DeviceSession):
        self.principal, self.device, self.session = principal, device, session


def sync_caller(
    principal: Principal = Depends(load_principal),
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    db: Session = Depends(get_db),
) -> SyncCaller:
    device, session = devices.authorize_request(db, principal, x_device_id)
    return SyncCaller(principal, device, session)


@router.post("/push", response_model=PushResponse)
def push(
    body: PushRequest,
    caller: SyncCaller = Depends(sync_caller),
    db: Session = Depends(get_db),
    tasks: TaskDispatcher = Depends(get_tasks),
):
    """Apply the device's queued changes in order. Safe to resend: see the mutation outcomes in app/domain/schemas/sync.py."""
    if caller.principal.is_superadmin:
        raise PermissionDenied("Platform administration changes need a live connection.")
    results = push_service.push(db, caller.principal, caller.device, body.mutations, tasks)
    return {
        "results": results,
        "cursor": pull_service.latest_cursor(db, caller.principal),
        "server_time": iso(datetime.datetime.utcnow()),
    }


@router.get("/pull", response_model=PullResponse)
def pull(
    cursor: int = Query(0, ge=0, description="The cursor returned by the previous pull; 0 for a full download."),
    limit: int = Query(500, ge=1, le=pull_service.MAX_PAGE),
    caller: SyncCaller = Depends(sync_caller),
    db: Session = Depends(get_db),
):
    """Changes after `cursor`, only from the caller's cooperative and only what their role may see."""
    return pull_service.pull_for_device(db, caller.principal, caller.device, cursor, limit)


@router.get("/status")
def sync_status(
    caller: SyncCaller = Depends(sync_caller),
    db: Session = Depends(get_db),
    tasks: TaskDispatcher = Depends(get_tasks),
):
    """Server health for this device: latest cursor, recent outcomes, offline session expiry."""
    # Opportunistic housekeeping after the response: stale-reading alerts and due SMS retries for this cooperative.
    background.housekeeping_later(tasks, caller.principal.cooperative_id, caller.principal)
    return push_service.device_status(db, caller.principal, caller.device, caller.session)


@router.post("/conflicts/resolve")
def resolve_conflict(body: ConflictResolution, caller: SyncCaller = Depends(sync_caller), db: Session = Depends(get_db)):
    """Record how a person resolved a conflicted or refused change on this device (audited)."""
    if not push_service.resolve_conflict(db, caller.principal, caller.device, body.mutation_id, body.resolution):
        raise NotFound("Conflict", "No open conflict with this id on this device.")
    return {"resolved": True}
