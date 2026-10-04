"""Offline synchronisation API: /api/v1/sync. See schemas/sync.py for the protocol.

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

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.access import Principal, load_principal
from core.utils import iso
from db import get_db
from models.sync import DeviceSession, MutationStatus, SyncMutation
from schemas.auth import UserRole
from schemas.sync import ConflictResolution, PullResponse, PushRequest, PushResponse
from services import cooler_alerts, notifications
from services.sync import devices, pull as pull_service, push as push_service

router = APIRouter(prefix="/api/v1/sync", tags=["Offline sync"])


class SyncCaller:
    def __init__(self, principal: Principal, device, session: DeviceSession):
        self.principal, self.device, self.session = principal, device, session


def sync_caller(
    principal: Principal = Depends(load_principal),
    x_device_id: Optional[str] = Header(None, alias="X-Device-Id"),
    db: Session = Depends(get_db),
) -> SyncCaller:
    if principal.role == UserRole.FARMER.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Offline sync isn't available for farmer accounts.")
    device, session = devices.authorize(db, principal, x_device_id)
    db.commit()
    return SyncCaller(principal, device, session)


@router.post("/push", response_model=PushResponse)
def push(body: PushRequest, caller: SyncCaller = Depends(sync_caller), db: Session = Depends(get_db)):
    """Apply the device's queued changes in order. Safe to resend: see the mutation outcomes in schemas/sync.py."""
    if caller.principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform administration changes need a live connection.")
    results = push_service.push(db, caller.principal, caller.device, body.mutations)
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
    result = pull_service.pull(db, caller.principal, cursor, limit)
    caller.device.last_sync_at = datetime.datetime.utcnow()
    db.commit()
    return result


@router.get("/status")
def sync_status(caller: SyncCaller = Depends(sync_caller), db: Session = Depends(get_db)):
    """Server health for this device: latest cursor, recent outcomes, offline session expiry."""
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    counts = dict(
        db.query(SyncMutation.status, func.count(SyncMutation.id))
        .filter(SyncMutation.device_id == caller.device.id, SyncMutation.received_at >= since)
        .group_by(SyncMutation.status)
        .all()
    )
    open_conflicts = db.query(func.count(SyncMutation.id)).filter(
        SyncMutation.device_id == caller.device.id, SyncMutation.status == MutationStatus.CONFLICT,
        SyncMutation.resolved_at.is_(None),
    ).scalar() or 0
    # Opportunistic housekeeping: stale-reading alerts and due SMS retries for this cooperative.
    if caller.principal.cooperative_id is not None:
        created = cooler_alerts.evaluate_staleness(db, caller.principal.cooperative_id)
        db.commit()
        notifications.dispatch(db, [n.id for n in created], caller.principal)
        notifications.dispatch_due(db, caller.principal.cooperative_id, caller.principal)
    return {
        "status": "ok",
        "server_time": iso(datetime.datetime.utcnow()),
        "cursor": pull_service.latest_cursor(db, caller.principal),
        "device": devices.device_json(caller.device),
        "offline_session_expires_at": iso(caller.session.expires_at),
        "last_24h": {
            "applied": counts.get(MutationStatus.APPLIED, 0),
            "rejected": counts.get(MutationStatus.REJECTED, 0),
            "conflicts": counts.get(MutationStatus.CONFLICT, 0),
        },
        "open_conflicts": open_conflicts,
    }


@router.post("/conflicts/resolve")
def resolve_conflict(body: ConflictResolution, caller: SyncCaller = Depends(sync_caller), db: Session = Depends(get_db)):
    """Record how a person resolved a conflicted or refused change on this device (audited)."""
    if not push_service.resolve_conflict(db, caller.principal, caller.device, body.mutation_id, body.resolution):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No open conflict with this id on this device.")
    return {"resolved": True}
