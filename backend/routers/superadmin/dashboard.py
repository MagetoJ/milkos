from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from db import get_db
from models.admin import CooperativeApplication, Cooler, SMSCreditPayment
from models.cooperative import Cooperative
from models.farmer import Farmer
from services import cooperatives, dashboard, search

router = APIRouter()


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return dashboard.summary(db)


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    """Compact headline numbers (kept for older clients; /dashboard has the full picture)."""
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


@router.get("/search")
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return search.global_search(db, q.strip(), limit)
