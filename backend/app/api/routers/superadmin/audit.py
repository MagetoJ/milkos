import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.utils import optional_uuid
from app.infrastructure.db.pagination import PageParams
from app.services.platform_admin import overview
from app.services.principal import Principal

router = APIRouter()


@router.get("/activity")
def get_activity(
    limit: int = Query(20, ge=1, le=200),
    include_security: bool = Query(False, description="Include sign-ins and other security events"),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    """Latest entries, newest first (the compact feed used on the dashboard). Security events (sign-ins...) are
    left out unless asked for; the full audit log always has them (entity_type=security)."""
    return overview.activity_feed(db, limit, include_security)


@router.get("/audit-logs")
def list_audit_logs(
    search: Optional[str] = Query(None, max_length=100),
    action: Optional[str] = Query(None, max_length=60, pattern=r"^[A-Z_]+$"),
    entity_type: Optional[str] = Query(None, max_length=50, pattern=r"^[a-z_]+$"),
    entity_id: Optional[str] = Query(None, max_length=64),
    actor_id: Optional[str] = None,
    actor_role: Optional[str] = Query(None, max_length=50),
    cooperative_id: Optional[str] = None,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return overview.audit_page(
        db, search=search, action=action, entity_type=entity_type, entity_id=entity_id,
        actor_id=optional_uuid(actor_id, "User"), actor_role=actor_role,
        cooperative_id=optional_uuid(cooperative_id, "Cooperative"),
        date_from=date_from, date_to=date_to, params=params,
    )
