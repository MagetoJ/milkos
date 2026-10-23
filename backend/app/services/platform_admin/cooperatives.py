"""Every cooperative: list, detail and SMS ledger."""
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.utils import iso, num
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.admin import AuditLog, SMSCreditPayment
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.finance import SmsCreditTransaction
from app.infrastructure.db.models.user import User
from app.infrastructure.db.pagination import PageParams, apply_sort, fetch_page, page_result
from app.services import audit, cooperatives, sms_credits
from app.services.principal import get_or_404

SORTS = {
    "name": Cooperative.name, "code": Cooperative.code, "county": Cooperative.county,
    "created_at": Cooperative.created_at, "status": Cooperative.status,
    "sms_credit_balance": Cooperative.sms_credit_balance,
}


def get(db: Session, coop_id: str) -> Cooperative:
    return get_or_404(db, Cooperative, coop_id, "Cooperative")


def summary_json(db: Session, coop: Cooperative) -> dict:
    return cooperatives.cooperative_json(coop, cooperatives.counts_for(db, [coop.id])[coop.id])


def list_page(db: Session, search: Optional[str], status: Optional[str], county: Optional[str], params: PageParams) -> dict:
    query = cooperatives.search_filter(db.query(Cooperative), search)
    if status:
        query = query.filter(Cooperative.status == status)
    if county:
        query = query.filter(Cooperative.county == county)
    query = apply_sort(query, params.sort, SORTS, [Cooperative.name, Cooperative.id])
    rows, total = fetch_page(query, params)
    counts = cooperatives.counts_for(db, [c.id for c in rows])
    return page_result([cooperatives.cooperative_json(c, counts[c.id]) for c in rows], total, params)


def detail(db: Session, coop: Cooperative) -> dict:
    """The cooperative with its administrators, milk volumes, SMS payment totals and recent activity."""
    admins = (
        db.query(User)
        .filter(User.cooperative_id == coop.id, User.role == UserRole.COOP_ADMIN)
        .order_by(User.is_active.desc(), User.created_at)
        .all()
    )
    payments = dict(
        db.query(SMSCreditPayment.status, func.count(SMSCreditPayment.id))
        .filter(SMSCreditPayment.cooperative_id == coop.id)
        .group_by(SMSCreditPayment.status)
        .all()
    )
    verified_kes = (
        db.query(func.coalesce(func.sum(SMSCreditPayment.amount_kes), 0))
        .filter(SMSCreditPayment.cooperative_id == coop.id, SMSCreditPayment.status == "VERIFIED")
        .scalar()
    )
    centres = db.query(func.count(CollectionCentre.id)).filter(CollectionCentre.cooperative_id == coop.id).scalar() or 0
    recent = (
        db.query(AuditLog).filter(AuditLog.cooperative_id == coop.id).order_by(AuditLog.created_at.desc()).limit(10).all()
    )
    return {
        **cooperatives.cooperative_json(coop, {**cooperatives.counts_for(db, [coop.id])[coop.id], "centres": centres}),
        "administrators": [
            {
                "id": str(u.id), "full_name": u.full_name, "email": u.email, "phone_number": u.phone_number,
                "is_active": bool(u.is_active), "last_login_at": iso(u.last_login_at),
            }
            for u in admins
        ],
        "milk": cooperatives.milk_volumes(db, coop.id),
        "payments": {
            "pending": payments.get("PENDING", 0),
            "verified": payments.get("VERIFIED", 0),
            "rejected": payments.get("REJECTED", 0),
            "verified_amount_kes": num(verified_kes) or 0.0,
        },
        "recent_activity": [audit.entry_json(e, coop.name) for e in recent],
    }


def sms_ledger(db: Session, coop_id: str, limit: int) -> dict:
    """Derived balances and the latest ledger entries of one cooperative."""
    coop = get(db, coop_id)
    rows = (
        db.query(SmsCreditTransaction, User.email).outerjoin(User, User.id == SmsCreditTransaction.actor_user_id)
        .filter(SmsCreditTransaction.cooperative_id == coop.id)
        .order_by(SmsCreditTransaction.created_at.desc()).limit(max(1, min(limit, 200))).all()
    )
    return {"balances": sms_credits.balances(db, coop.id), "transactions": [sms_credits.transaction_json(t, e) for t, e in rows]}
