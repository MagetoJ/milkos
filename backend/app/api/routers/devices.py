"""Device registration and offline sessions: /api/v1/devices. See app/services/sync/devices.py."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.cookies import start_session
from app.api.dependencies.auth import load_principal
from app.api.dependencies.db import get_db
from app.domain.schemas.sync import DeviceRegister, DeviceSessionToken
from app.services.principal import Principal
from app.services.sync import devices

router = APIRouter(prefix="/api/v1/devices", tags=["Devices"])


@router.post("/register")
def register_device(payload: DeviceRegister, principal: Principal = Depends(load_principal), db: Session = Depends(get_db)):
    """Register this app installation for the signed-in user and issue their offline session.

    Call right after an online login. The response's `offline_session.token` is shown once; keep it in
    the device's local database (never in a cookie or URL)."""
    device, session, token = devices.register(db, principal, payload)
    return {"offline_session": devices.offline_session_json(db, principal.user, session, device, token)}


@router.post("/session/refresh")
def refresh_session(payload: DeviceSessionToken, response: Response, db: Session = Depends(get_db)):
    """Exchange a still-valid offline session for a new access token (no access token needed).

    The account, its role, its cooperative and the device are re-checked against the database. The
    session secret is rotated: store the returned one."""
    user, device, session, token = devices.refresh(db, payload.device_identifier, payload.session_token)
    role = user.role_value
    access_token = start_session(response, user)
    return {
        "access_token": access_token,
        "role": role,
        "user_id": str(user.id),
        "offline_session": devices.offline_session_json(db, user, session, device, token),
    }


@router.post("/session/revoke")
def revoke_session(payload: DeviceSessionToken, db: Session = Depends(get_db)):
    """End an offline session (sign-out). Idempotent."""
    return {"revoked": devices.revoke(db, payload.device_identifier, payload.session_token)}
