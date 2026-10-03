"""Platform command-centre numbers. Every figure is a database aggregate; no table is loaded in full."""
import datetime

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.utils import iso, num
from models.admin import AuditLog, CooperativeApplication, Cooler, CoolerStatus, SMSCreditPayment
from models.cooperative import Cooperative, CooperativeStatus
from models.farmer import Farmer
from models.operations import Collector, MilkCollection, QualityStatus
from models.user import User
from schemas.auth import UserRole
from services import audit, cooperatives, settings


def _status_counts(db: Session, column, model) -> dict:
    return {status: n for status, n in db.query(column, func.count(model.id)).group_by(column).all()}


def summary(db: Session) -> dict:
    coop_status = _status_counts(db, Cooperative.status, Cooperative)
    roles = {
        (role.value if hasattr(role, "value") else role): n
        for role, n in db.query(User.role, func.count(User.id)).filter(User.is_active.is_(True)).group_by(User.role).all()
    }
    total_users = db.query(func.count(User.id)).scalar() or 0
    farmer_status = _status_counts(db, Farmer.status, Farmer)
    collector_status = _status_counts(db, Collector.status, Collector)

    active_cooler = Cooler.status == CoolerStatus.ACTIVE
    coolers_total, coolers_operational, coolers_offline = db.query(
        func.count(Cooler.id),
        func.coalesce(func.sum(case(((active_cooler) & (Cooler.is_operational.is_(True)), 1), else_=0)), 0),
        func.coalesce(func.sum(case(((active_cooler) & (Cooler.is_operational.isnot(True)), 1), else_=0)), 0),
    ).one()

    sms_total, low_balance = db.query(
        func.coalesce(func.sum(Cooperative.sms_credit_balance), 0),
        func.coalesce(func.sum(case(
            (Cooperative.sms_credit_balance <= settings.get(db, "sms.low_balance_threshold"), 1), else_=0,
        )), 0),
    ).filter(Cooperative.status == CooperativeStatus.ACTIVE).one()
    pending_payments, pending_credits, pending_amount = db.query(
        func.count(SMSCreditPayment.id),
        func.coalesce(func.sum(SMSCreditPayment.credits_requested), 0),
        func.coalesce(func.sum(SMSCreditPayment.amount_kes), 0),
    ).filter(SMSCreditPayment.status == "PENDING").one()

    today = datetime.datetime.utcnow().date()
    start = today - datetime.timedelta(days=13)
    daily = dict(
        db.query(MilkCollection.collection_date, func.coalesce(func.sum(MilkCollection.quantity_litres), 0))
        .filter(MilkCollection.collection_date >= start, MilkCollection.quality_status == QualityStatus.ACCEPTED)
        .group_by(MilkCollection.collection_date)
        .all()
    )
    series = [
        {"date": iso(start + datetime.timedelta(days=i)), "litres": num(daily.get(start + datetime.timedelta(days=i))) or 0.0}
        for i in range(14)
    ]

    month_start = today - datetime.timedelta(days=29)
    top = (
        db.query(Cooperative.id, Cooperative.name, Cooperative.code, func.sum(MilkCollection.quantity_litres).label("litres"))
        .join(MilkCollection, MilkCollection.cooperative_id == Cooperative.id)
        .filter(MilkCollection.collection_date >= month_start, MilkCollection.quality_status == QualityStatus.ACCEPTED)
        .group_by(Cooperative.id, Cooperative.name, Cooperative.code)
        .order_by(func.sum(MilkCollection.quantity_litres).desc())
        .limit(5)
        .all()
    )

    recent = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(10).all()

    return {
        "cooperatives": {
            "total": sum(coop_status.values()),
            "active": coop_status.get(CooperativeStatus.ACTIVE, 0),
            "suspended": coop_status.get(CooperativeStatus.SUSPENDED, 0),
        },
        "users": {
            "total": total_users,
            "active": sum(roles.values()),
            "superadmins": roles.get(UserRole.SUPER_ADMIN.value, 0),
            "coop_admins": roles.get(UserRole.COOP_ADMIN.value, 0),
            "managers": roles.get(UserRole.MANAGER.value, 0),
            "collector_accounts": roles.get(UserRole.COLLECTOR.value, 0),
            "farmer_accounts": roles.get(UserRole.FARMER.value, 0),
        },
        "farmers": {"total": sum(farmer_status.values()), "active": farmer_status.get("ACTIVE", 0)},
        "collectors": {"total": sum(collector_status.values()), "active": collector_status.get("ACTIVE", 0)},
        "coolers": {
            "total": coolers_total or 0,
            "operational": int(coolers_operational or 0),
            "offline": int(coolers_offline or 0),
        },
        "milk": {**cooperatives.milk_volumes(db), "daily": series},
        "pending": {
            "applications": db.query(func.count(CooperativeApplication.id))
            .filter(CooperativeApplication.status == "PENDING").scalar() or 0,
            "payments": pending_payments or 0,
            "payment_credits": int(pending_credits or 0),
            "payment_amount_kes": num(pending_amount) or 0.0,
        },
        "sms": {"total_balance": int(sms_total or 0), "low_balance_cooperatives": int(low_balance or 0)},
        "top_cooperatives": [
            {"id": str(cid), "name": name, "code": code, "litres_30d": num(litres) or 0.0}
            for cid, name, code, litres in top
        ],
        "recent_activity": [audit.entry_json(entry) for entry in recent],
        "generated_at": iso(datetime.datetime.utcnow()),
    }

