"""Platform headline numbers and the activity feed."""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.utils import like
from app.infrastructure.db.models.admin import AuditLog, Cooler, CooperativeApplication, SMSCreditPayment
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.pagination import PageParams, paginate
from app.services import audit, cooperatives


def headline_counts(db: Session) -> dict:
    """Compact headline numbers (kept for older clients; dashboard.summary has the full picture)."""
    milk = cooperatives.milk_volumes(db)
    return {
        "total_cooperatives": db.query(func.count(Cooperative.id)).scalar() or 0,
        "total_coolers": db.query(func.count(Cooler.id)).scalar() or 0,
        "total_farmers": db.query(func.count(Farmer.id)).scalar() or 0,
        "milk_today_litres": milk["today"],
        "pending_applications_count": db.query(func.count(CooperativeApplication.id))
        .filter(CooperativeApplication.status == "PENDING").scalar() or 0,
        "pending_payments_count": db.query(func.count(SMSCreditPayment.id))
        .filter(SMSCreditPayment.status == "PENDING").scalar() or 0,
    }


def _with_cooperative(db: Session):
    return db.query(AuditLog, Cooperative.name).outerjoin(Cooperative, Cooperative.id == AuditLog.cooperative_id)


def activity_feed(db: Session, limit: int, include_security: bool) -> list[dict]:
    """Latest entries, newest first. Security events (sign-ins...) only when asked for."""
    query = _with_cooperative(db)
    if not include_security:
        query = query.filter(or_(AuditLog.entity_type.is_(None), AuditLog.entity_type != "security"))
    rows = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [audit.entry_json(entry, name) for entry, name in rows]


def audit_page(db: Session, *, search: Optional[str], action: Optional[str], entity_type: Optional[str],
               entity_id: Optional[str], actor_id: Optional[UUID], actor_role: Optional[str],
               cooperative_id: Optional[UUID], date_from: Optional[datetime.date], date_to: Optional[datetime.date],
               params: PageParams) -> dict:
    """The full audit log, filtered, plus every action name (for the filter list)."""
    query = _with_cooperative(db)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if actor_id:
        query = query.filter(AuditLog.admin_id == actor_id)
    if actor_role:
        query = query.filter(AuditLog.actor_role == actor_role)
    if cooperative_id:
        query = query.filter(AuditLog.cooperative_id == cooperative_id)
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


def entity_history(db: Session, entity_type: str, entity_id, limit: Optional[int] = None) -> list[dict]:
    """Audit entries about one record, newest first."""
    query = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == entity_type, AuditLog.entity_id == str(entity_id))
        .order_by(AuditLog.created_at.desc())
    )
    if limit:
        query = query.limit(limit)
    return [audit.entry_json(e) for e in query.all()]
