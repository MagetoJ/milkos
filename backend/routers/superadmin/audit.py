import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, page_params, paginate
from core.utils import like, parse_uuid
from db import get_db
from models.admin import AuditLog
from models.cooperative import Cooperative
from services import audit

router = APIRouter()


@router.get("/activity")
def get_activity(
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    """Latest entries, newest first (the compact feed used on the dashboard)."""
    rows = (
        db.query(AuditLog, Cooperative.name)
        .outerjoin(Cooperative, Cooperative.id == AuditLog.cooperative_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [audit.entry_json(entry, name) for entry, name in rows]


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
    query = db.query(AuditLog, Cooperative.name).outerjoin(Cooperative, Cooperative.id == AuditLog.cooperative_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if actor_id:
        query = query.filter(AuditLog.admin_id == parse_uuid(actor_id, "User"))
    if actor_role:
        query = query.filter(AuditLog.actor_role == actor_role)
    if cooperative_id:
        query = query.filter(AuditLog.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if date_from:
        query = query.filter(AuditLog.created_at >= datetime.datetime.combine(date_from, datetime.time.min))
    if date_to:
        query = query.filter(AuditLog.created_at < datetime.datetime.combine(date_to + datetime.timedelta(days=1), datetime.time.min))
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            AuditLog.target.ilike(pattern, escape="\\"), AuditLog.actor_email.ilike(pattern, escape="\\"),
            AuditLog.action.ilike(pattern, escape="\\"),
        ))
    query = query.order_by(AuditLog.created_at.desc(), AuditLog.id)
    result = paginate(query, params, lambda row: audit.entry_json(row[0], row[1]))
    result["actions"] = sorted(a for (a,) in db.query(AuditLog.action).distinct().all())
    return result
