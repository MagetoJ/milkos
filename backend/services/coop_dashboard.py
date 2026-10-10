"""Cooperative dashboard figures and charts. Every number is a database aggregate over one cooperative."""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, case, distinct, func
from sqlalchemy.orm import Session

from core.utils import iso, num
from models.admin import Cooler, CoolerStatus
from models.farmer import Farmer
from models.finance import FarmerPayment, PaymentStatus
from models.inbox import InboxNotification
from models.notifications import Notification, NotificationStatus
from models.operations import (
    BatchStatus, CollectionBatch, CollectionCorrectionRequest, Collector, LineStatus, MilkCollection, QualityStatus,
    RequestStatus,
)
from services import sms_credits

ACCEPTED = and_(MilkCollection.record_status == LineStatus.ACTIVE, MilkCollection.quality_status == QualityStatus.ACCEPTED)
ALERT_TYPES = ("LOW_VOLUME", "HIGH_VOLUME", "TEMPERATURE_OUT_OF_RANGE", "LOW_BATTERY", "STALE_READING", "SENSOR_DISCONNECTED")


def kpis(db: Session, cooperative_id: UUID) -> dict:
    today = datetime.datetime.utcnow().date()
    month_start = today.replace(day=1)
    since_30 = today - datetime.timedelta(days=29)
    kg_today, kg_month, kg_30 = db.query(
        func.coalesce(func.sum(case((and_(ACCEPTED, MilkCollection.collection_date == today), MilkCollection.quantity_kg), else_=0)), 0),
        func.coalesce(func.sum(case((and_(ACCEPTED, MilkCollection.collection_date >= month_start), MilkCollection.quantity_kg), else_=0)), 0),
        func.coalesce(func.sum(case((ACCEPTED, MilkCollection.quantity_kg), else_=0)), 0),
    ).filter(MilkCollection.cooperative_id == cooperative_id, MilkCollection.collection_date >= min(month_start, since_30)).one()
    active_farmers = db.query(func.count(distinct(MilkCollection.farmer_id))).filter(
        MilkCollection.cooperative_id == cooperative_id, MilkCollection.collection_date >= since_30,
        MilkCollection.record_status == LineStatus.ACTIVE,
    ).scalar() or 0
    batches_today = db.query(func.count(CollectionBatch.id)).filter(
        CollectionBatch.cooperative_id == cooperative_id, CollectionBatch.collection_date == today,
        CollectionBatch.status.in_(BatchStatus.EFFECTIVE),
    ).scalar() or 0
    collectors_active = db.query(func.count(Collector.id)).filter(Collector.cooperative_id == cooperative_id, Collector.status == "ACTIVE").scalar() or 0
    collectors_today = db.query(func.count(distinct(CollectionBatch.collector_id))).filter(
        CollectionBatch.cooperative_id == cooperative_id, CollectionBatch.collection_date == today,
    ).scalar() or 0
    coolers_active, coolers_online = db.query(
        func.count(Cooler.id), func.coalesce(func.sum(case((Cooler.is_operational.is_(True), 1), else_=0)), 0),
    ).filter(Cooler.cooperative_id == cooperative_id, Cooler.status == CoolerStatus.ACTIVE).one()
    pending_corrections = db.query(func.count(CollectionCorrectionRequest.id)).filter(
        CollectionCorrectionRequest.cooperative_id == cooperative_id, CollectionCorrectionRequest.status == RequestStatus.PENDING,
    ).scalar() or 0
    pending_payments, pending_amount = db.query(
        func.count(FarmerPayment.id), func.coalesce(func.sum(FarmerPayment.net_amount), 0),
    ).filter(FarmerPayment.cooperative_id == cooperative_id, FarmerPayment.status.in_(PaymentStatus.OPEN)).one()
    since_day = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    cooler_alerts = db.query(func.count(InboxNotification.id)).filter(
        InboxNotification.cooperative_id == cooperative_id, InboxNotification.category == "COOLER",
        InboxNotification.created_at >= since_day,
    ).scalar() or 0
    since_30_dt = datetime.datetime.utcnow() - datetime.timedelta(days=30)
    sent, failed = db.query(
        func.coalesce(func.sum(case((Notification.status == NotificationStatus.SENT, 1), else_=0)), 0),
        func.coalesce(func.sum(case((Notification.status.in_((NotificationStatus.FAILED, NotificationStatus.REFUNDED)), 1), else_=0)), 0),
    ).filter(Notification.cooperative_id == cooperative_id, Notification.created_at >= since_30_dt).one()
    sent, failed = int(sent or 0), int(failed or 0)
    balances = sms_credits.balances(db, cooperative_id)
    return {
        "milk_kg_today": num(kg_today) or 0.0,
        "milk_kg_month": num(kg_month) or 0.0,
        "milk_kg_30d": num(kg_30) or 0.0,
        "collections_today": int(batches_today),
        "active_farmers_30d": int(active_farmers),
        "active_collectors": int(collectors_active),
        "collectors_today": int(collectors_today),
        "active_coolers": int(coolers_active or 0),
        "coolers_online": int(coolers_online or 0),
        "sms_available": balances["available"],
        "sms_reserved": balances["reserved"],
        "sms_success_rate_30d": round(sent / (sent + failed) * 100, 1) if (sent + failed) else None,
        "sms_sent_30d": sent,
        "sms_failed_30d": failed,
        "pending_corrections": int(pending_corrections),
        "pending_payments": int(pending_payments or 0),
        "pending_payments_amount": num(pending_amount) or 0.0,
        "cooler_alerts_24h": int(cooler_alerts),
    }


RANGES = {"today": 1, "7d": 7, "30d": 30, "3m": 90}


def charts(db: Session, cooperative_id: UUID, days: int = 14, start: Optional[datetime.date] = None,
           end: Optional[datetime.date] = None) -> dict:
    """Daily trend for `days` days ending today, or for an explicit [start, end] window (both inclusive)."""
    today = datetime.datetime.utcnow().date()
    if start is not None and end is not None:
        days = (end - start).days + 1
    else:
        start = today - datetime.timedelta(days=days - 1)
    end = start + datetime.timedelta(days=days - 1)
    daily = {
        d: (num(kg) or 0.0, int(f or 0))
        for d, kg, f in db.query(
            MilkCollection.collection_date,
            func.coalesce(func.sum(case((ACCEPTED, MilkCollection.quantity_kg), else_=0)), 0),
            func.count(distinct(case((MilkCollection.record_status == LineStatus.ACTIVE, MilkCollection.farmer_id)))),
        ).filter(MilkCollection.cooperative_id == cooperative_id, MilkCollection.collection_date >= start,
                 MilkCollection.collection_date <= end)
        .group_by(MilkCollection.collection_date)
    }
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end + datetime.timedelta(days=1), datetime.time.min)
    sms_rows = db.query(Notification.created_at, Notification.status).filter(
        Notification.cooperative_id == cooperative_id, Notification.created_at >= start_dt, Notification.created_at < end_dt,
    ).all()
    sms_daily: dict = {}
    for created, status in sms_rows:
        key = created.date()
        sent, failed = sms_daily.get(key, (0, 0))
        if status in (NotificationStatus.SENT, NotificationStatus.DELIVERED):
            sent += 1
        elif status in (NotificationStatus.FAILED, NotificationStatus.REFUNDED):
            failed += 1
        sms_daily[key] = (sent, failed)
    trend = []
    for i in range(days):
        day = start + datetime.timedelta(days=i)
        kg, farmers = daily.get(day, (0.0, 0))
        sent, failed = sms_daily.get(day, (0, 0))
        trend.append({"date": iso(day), "kg": kg, "farmers": farmers, "sms_sent": sent, "sms_failed": failed})
    month_start = today - datetime.timedelta(days=29)
    coolers = [
        {"id": str(cid), "name": name, "code": code, "kg_30d": num(kg) or 0.0}
        for cid, name, code, kg in db.query(
            Cooler.id, Cooler.name, Cooler.code,
            func.coalesce(func.sum(case((and_(CollectionBatch.status.in_(BatchStatus.EFFECTIVE), CollectionBatch.collection_date >= month_start),
                                         CollectionBatch.allocated_weight_kg), else_=0)), 0),
        ).outerjoin(CollectionBatch, CollectionBatch.cooler_id == Cooler.id)
        .filter(Cooler.cooperative_id == cooperative_id, Cooler.status == CoolerStatus.ACTIVE)
        .group_by(Cooler.id, Cooler.name, Cooler.code).order_by(Cooler.code)
    ]
    top_farmers = [
        {"id": str(fid), "name": f"{first} {last}", "farmer_number": number, "kg_30d": num(kg) or 0.0}
        for fid, first, last, number, kg in db.query(
            Farmer.id, Farmer.first_name, Farmer.last_name, Farmer.farmer_number, func.sum(MilkCollection.quantity_kg),
        ).join(MilkCollection, MilkCollection.farmer_id == Farmer.id)
        .filter(Farmer.cooperative_id == cooperative_id, MilkCollection.collection_date >= month_start, ACCEPTED)
        .group_by(Farmer.id, Farmer.first_name, Farmer.last_name, Farmer.farmer_number)
        .order_by(func.sum(MilkCollection.quantity_kg).desc()).limit(8)
    ]
    return {"trend": trend, "coolers": coolers, "top_farmers": top_farmers}
