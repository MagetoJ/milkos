from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, fetch_page, page_params, page_result
from core.utils import iso, num, parse_uuid
from db import get_db
from models.admin import AuditLog, SMSCreditPayment
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.user import User
from schemas.auth import UserRole
from schemas.platform import CooperativeCreate, CooperativeStatusChange, CooperativeUpdate, SmsCreditAdjustment
from services import audit, cooperatives

router = APIRouter(prefix="/cooperatives")

SORTS = {
    "name": Cooperative.name, "code": Cooperative.code, "county": Cooperative.county,
    "created_at": Cooperative.created_at, "status": Cooperative.status,
    "sms_credit_balance": Cooperative.sms_credit_balance,
}


def _get(db: Session, coop_id: str) -> Cooperative:
    coop = db.get(Cooperative, parse_uuid(coop_id, "Cooperative"))
    if coop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooperative not found")
    return coop


@router.get("")
def list_cooperatives(
    search: Optional[str] = Query(None, max_length=100),
    coop_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|SUSPENDED)$"),
    county: Optional[str] = Query(None, max_length=50),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = cooperatives.search_filter(db.query(Cooperative), search)
    if coop_status:
        query = query.filter(Cooperative.status == coop_status)
    if county:
        query = query.filter(Cooperative.county == county)
    query = apply_sort(query, params.sort, SORTS, [Cooperative.name, Cooperative.id])

    rows, total = fetch_page(query, params)
    counts = cooperatives.counts_for(db, [c.id for c in rows])
    return page_result([cooperatives.cooperative_json(c, counts[c.id]) for c in rows], total, params)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cooperative(
    payload: CooperativeCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    coop = cooperatives.create(db, admin, payload)
    return cooperatives.cooperative_json(coop, cooperatives.counts_for(db, [coop.id])[coop.id])


@router.get("/{coop_id}")
def get_cooperative(coop_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    coop = _get(db, coop_id)
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


@router.put("/{coop_id}")
def update_cooperative(
    coop_id: str, payload: CooperativeUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    coop = cooperatives.update(db, admin, _get(db, coop_id), payload)
    return cooperatives.cooperative_json(coop, cooperatives.counts_for(db, [coop.id])[coop.id])


@router.patch("/{coop_id}/status")
def change_cooperative_status(
    coop_id: str, payload: CooperativeStatusChange, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    coop = cooperatives.set_status(db, admin, parse_uuid(coop_id, "Cooperative"), payload.status, payload.reason)
    return cooperatives.cooperative_json(coop)


@router.get("/{coop_id}/sms-ledger")
def sms_ledger(coop_id: str, limit: int = 50, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    """Derived balances and the latest ledger entries of one cooperative."""
    from models.finance import SmsCreditTransaction
    from models.user import User
    from services import sms_credits

    coop = db.get(Cooperative, parse_uuid(coop_id, "Cooperative"))
    if coop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooperative not found")
    rows = (
        db.query(SmsCreditTransaction, User.email).outerjoin(User, User.id == SmsCreditTransaction.actor_user_id)
        .filter(SmsCreditTransaction.cooperative_id == coop.id)
        .order_by(SmsCreditTransaction.created_at.desc()).limit(max(1, min(limit, 200))).all()
    )
    return {"balances": sms_credits.balances(db, coop.id), "transactions": [sms_credits.transaction_json(t, e) for t, e in rows]}


@router.post("/{coop_id}/sms-credits")
def adjust_sms_credits(
    coop_id: str, payload: SmsCreditAdjustment, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    coop = cooperatives.adjust_sms_credits(db, admin, parse_uuid(coop_id, "Cooperative"), payload.delta, payload.reason)
    return cooperatives.cooperative_json(coop)
