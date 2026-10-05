"""Reporting center: tabular reports over a date range, scoped to one cooperative (or the platform for staff).

Every report is a list of columns, rows and a summary, rendered as JSON, CSV or XLSX by routers/reports.py.
The cooperative is always decided by the caller (routers/reports.py uses core.access.cooperative_scope); the
functions here filter every query by it. Exports are capped at MAX_ROWS rows.
"""
import csv
import datetime
import io
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from uuid import UUID

from sqlalchemy import and_, case, distinct, func
from sqlalchemy.orm import Session, aliased

from core.utils import iso, num
from models.admin import AuditLog, Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.finance import FarmerPayment, MilkPrice
from models.notifications import Notification, NotificationStatus
from models.operations import (
    BatchStatus, CollectionBatch, CollectionCorrectionRequest, Collector, LineStatus, MilkCollection, QualityStatus,
    RequestType, WeightSource,
)
from models.sensors import CoolerReading
from models.sync import Device, SyncMutation
from models.user import User
from services.notifications import mask_phone

MAX_ROWS = 10_000
EFFECTIVE_LINE = MilkCollection.record_status == LineStatus.ACTIVE
ACCEPTED_LINE = and_(EFFECTIVE_LINE, MilkCollection.quality_status == QualityStatus.ACCEPTED)
EFFECTIVE_BATCH = CollectionBatch.status.in_(BatchStatus.EFFECTIVE)


@dataclass
class Report:
    kind: str
    title: str
    columns: list[tuple[str, str]]  # (key, label)
    rows: list[dict]
    summary: dict = field(default_factory=dict)
    truncated: bool = False

    def as_json(self, start: datetime.date, end: datetime.date, cooperative_id: Optional[UUID]) -> dict:
        return {
            "kind": self.kind, "title": self.title,
            "range": {"from": iso(start), "to": iso(end)},
            "cooperative_id": str(cooperative_id) if cooperative_id else None,
            "columns": [{"key": k, "label": label} for k, label in self.columns],
            "rows": self.rows, "summary": self.summary, "truncated": self.truncated, "row_count": len(self.rows),
        }

    def table(self) -> tuple[list[str], list[list[Any]]]:
        return [label for _, label in self.columns], [[row.get(k) for k, _ in self.columns] for row in self.rows]


def _safe(value: Any) -> Any:
    """Neutralise spreadsheet formula injection in CSV cells."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def to_csv(report: Report) -> str:
    header, rows = report.table()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    for row in rows:
        writer.writerow([_safe(v) for v in row])
    return out.getvalue()


def _limit(query) -> tuple[list, bool]:
    rows = query.limit(MAX_ROWS + 1).all()
    return rows[:MAX_ROWS], len(rows) > MAX_ROWS


def _scope(query, column, cooperative_id: Optional[UUID]):
    return query.filter(column == cooperative_id) if cooperative_id is not None else query


CollectorUser = aliased(User, name="report_collector_user")


# ---------------- reports ----------------

def collections_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    q = (
        db.query(MilkCollection, Farmer, CollectionBatch, Cooler.name, CollectionCentre.name, CollectorUser.full_name, Cooperative.name)
        .join(Farmer, Farmer.id == MilkCollection.farmer_id)
        .join(CollectionBatch, CollectionBatch.id == MilkCollection.batch_id)
        .join(Cooperative, Cooperative.id == MilkCollection.cooperative_id)
        .outerjoin(Cooler, Cooler.id == MilkCollection.cooler_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == MilkCollection.centre_id)
        .outerjoin(Collector, Collector.id == MilkCollection.collector_id)
        .outerjoin(CollectorUser, CollectorUser.id == Collector.user_id)
        .filter(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end)
    )
    q = _scope(q, MilkCollection.cooperative_id, coop)
    if not f.get("include_history"):
        q = q.filter(EFFECTIVE_LINE)
    for key, column in (("farmer_id", MilkCollection.farmer_id), ("collector_id", MilkCollection.collector_id),
                        ("cooler_id", MilkCollection.cooler_id), ("centre_id", MilkCollection.centre_id)):
        if f.get(key):
            q = q.filter(column == f[key])
    if f.get("quality_status"):
        q = q.filter(MilkCollection.quality_status == f["quality_status"])
    rows, truncated = _limit(q.order_by(MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc(), MilkCollection.reference))
    out = [
        {
            "date": iso(m.collection_date), "time": m.collection_time.strftime("%H:%M") if m.collection_time else None,
            "reference": m.reference, "batch": b.reference, "cooperative": coop_name,
            "farmer_number": fa.farmer_number, "farmer": fa.full_name, "collector": collector, "cooler": cooler,
            "centre": centre, "kg": num(m.quantity_kg), "litres": num(m.quantity_litres), "fat": num(m.fat_percentage),
            "quality": m.quality_status, "status": m.record_status, "weight_source": b.weight_source,
        }
        for m, fa, b, cooler, centre, collector, coop_name in rows
    ]
    accepted = [r for r in out if r["quality"] == QualityStatus.ACCEPTED and r["status"] == LineStatus.ACTIVE]
    return Report("collections", "Collection report", [
        ("date", "Date"), ("time", "Time"), ("reference", "Reference"), ("batch", "Batch"), ("cooperative", "Cooperative"),
        ("farmer_number", "Farmer no."), ("farmer", "Farmer"), ("collector", "Collector"), ("cooler", "Cooler"),
        ("centre", "Centre"), ("kg", "KG"), ("litres", "Litres"), ("fat", "Fat %"), ("quality", "Quality"),
        ("status", "Record status"), ("weight_source", "Weight source"),
    ], out, {
        "lines": len(out), "accepted_kg": round(sum(r["kg"] or 0 for r in accepted), 2),
        "farmers": len({r["farmer_number"] for r in out}),
    }, truncated)


def farmers_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    in_range = and_(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end)
    q = (
        db.query(
            Farmer, CollectionCentre.name,
            func.coalesce(func.sum(case((and_(in_range, ACCEPTED_LINE), MilkCollection.quantity_kg), else_=0)), 0),
            func.coalesce(func.sum(case((and_(in_range, EFFECTIVE_LINE, MilkCollection.quality_status == QualityStatus.REJECTED), MilkCollection.quantity_kg), else_=0)), 0),
            func.coalesce(func.sum(case((and_(in_range, EFFECTIVE_LINE), 1), else_=0)), 0),
            func.max(case((and_(in_range, EFFECTIVE_LINE), MilkCollection.collection_date))),
        )
        .outerjoin(CollectionCentre, CollectionCentre.id == Farmer.centre_id)
        .outerjoin(MilkCollection, MilkCollection.farmer_id == Farmer.id)
        .group_by(Farmer.id, CollectionCentre.name)
    )
    q = _scope(q, Farmer.cooperative_id, coop)
    if f.get("centre_id"):
        q = q.filter(Farmer.centre_id == f["centre_id"])
    rows, truncated = _limit(q.order_by(Farmer.farmer_number))
    out = [
        {"farmer_number": fa.farmer_number, "farmer": fa.full_name, "phone": fa.phone, "centre": centre, "status": fa.status,
         "deliveries": int(n or 0), "accepted_kg": num(acc) or 0.0, "rejected_kg": num(rej) or 0.0, "last_delivery": iso(last)}
        for fa, centre, acc, rej, n, last in rows
    ]
    return Report("farmers", "Farmer report", [
        ("farmer_number", "Farmer no."), ("farmer", "Farmer"), ("phone", "Phone"), ("centre", "Centre"), ("status", "Status"),
        ("deliveries", "Deliveries"), ("accepted_kg", "Accepted KG"), ("rejected_kg", "Rejected KG"), ("last_delivery", "Last delivery"),
    ], out, {"farmers": len(out), "active_suppliers": sum(1 for r in out if r["deliveries"]),
             "accepted_kg": round(sum(r["accepted_kg"] for r in out), 2)}, truncated)


def collectors_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    in_range = and_(CollectionBatch.collection_date >= start, CollectionBatch.collection_date <= end, EFFECTIVE_BATCH)
    q = (
        db.query(
            Collector, User,
            func.coalesce(func.sum(case((in_range, 1), else_=0)), 0),
            func.coalesce(func.sum(case((in_range, CollectionBatch.captured_weight_kg), else_=0)), 0),
            func.coalesce(func.sum(case((in_range, CollectionBatch.allocated_weight_kg), else_=0)), 0),
            func.coalesce(func.sum(case((and_(in_range, CollectionBatch.weight_source == WeightSource.MANUAL), 1), else_=0)), 0),
            func.max(case((in_range, CollectionBatch.collection_date))),
        )
        .join(User, User.id == Collector.user_id)
        .outerjoin(CollectionBatch, CollectionBatch.collector_id == Collector.id)
        .group_by(Collector.id, User.id)
    )
    q = _scope(q, Collector.cooperative_id, coop)
    rows, truncated = _limit(q.order_by(Collector.collector_number))
    out = [
        {"collector_number": c.collector_number, "collector": u.full_name, "phone": u.phone_number, "status": c.status,
         "batches": int(n or 0), "captured_kg": num(cap) or 0.0, "allocated_kg": num(alloc) or 0.0,
         "manual_weights": int(manual or 0), "last_collection": iso(last)}
        for c, u, n, cap, alloc, manual, last in rows
    ]
    return Report("collectors", "Collector report", [
        ("collector_number", "Collector no."), ("collector", "Collector"), ("phone", "Phone"), ("status", "Status"),
        ("batches", "Collections"), ("captured_kg", "Captured KG"), ("allocated_kg", "Allocated KG"),
        ("manual_weights", "Manual weights"), ("last_collection", "Last collection"),
    ], out, {"collectors": len(out), "captured_kg": round(sum(r["captured_kg"] for r in out), 2)}, truncated)


def coolers_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    batch_totals = dict(
        (cid, (n, kg)) for cid, n, kg in _scope(
            db.query(CollectionBatch.cooler_id, func.count(CollectionBatch.id), func.coalesce(func.sum(CollectionBatch.allocated_weight_kg), 0))
            .filter(CollectionBatch.collection_date >= start, CollectionBatch.collection_date <= end, EFFECTIVE_BATCH),
            CollectionBatch.cooperative_id, coop,
        ).group_by(CollectionBatch.cooler_id)
    )
    readings = dict(
        (cid, (n, avg_t)) for cid, n, avg_t in _scope(
            db.query(CoolerReading.cooler_id, func.count(CoolerReading.id), func.avg(CoolerReading.temperature_celsius))
            .filter(CoolerReading.measured_at >= start_dt, CoolerReading.measured_at <= end_dt),
            CoolerReading.cooperative_id, coop,
        ).group_by(CoolerReading.cooler_id)
    )
    alerts = dict(
        (cid, n) for cid, n in _scope(
            db.query(Notification.cooler_id, func.count(distinct(Notification.created_at)))
            .filter(Notification.created_at >= start_dt, Notification.created_at <= end_dt, Notification.type != "COLLECTION_RECEIPT"),
            Notification.cooperative_id, coop,
        ).group_by(Notification.cooler_id)
    )
    q = _scope(db.query(Cooler, CollectionCentre.name).outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id), Cooler.cooperative_id, coop)
    rows, truncated = _limit(q.order_by(Cooler.code))
    out = []
    for c, centre in rows:
        n, kg = batch_totals.get(c.id, (0, 0))
        rn, avg_t = readings.get(c.id, (0, None))
        out.append({
            "code": c.code, "cooler": c.name, "centre": centre, "status": c.status, "operational": bool(c.is_operational),
            "batches": int(n or 0), "kg": num(kg) or 0.0, "current_volume_litres": num(c.current_volume_litres),
            "capacity_litres": num(c.capacity_litres), "readings": int(rn or 0),
            "average_temperature_c": round(float(avg_t), 2) if avg_t is not None else None,
            "alerts": int(alerts.get(c.id, 0)), "last_seen": iso(c.last_seen_at),
        })
    return Report("coolers", "Cooler report", [
        ("code", "Code"), ("cooler", "Cooler"), ("centre", "Centre"), ("status", "Status"), ("operational", "Operational"),
        ("batches", "Collections"), ("kg", "KG received"), ("current_volume_litres", "Current volume (L)"),
        ("capacity_litres", "Capacity (L)"), ("readings", "Readings"), ("average_temperature_c", "Avg temp °C"),
        ("alerts", "Alerts"), ("last_seen", "Last seen"),
    ], out, {"coolers": len(out), "kg": round(sum(r["kg"] for r in out), 2)}, truncated)


def centres_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    in_range = and_(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end, ACCEPTED_LINE)
    q = (
        db.query(
            CollectionCentre,
            func.coalesce(func.sum(case((in_range, MilkCollection.quantity_kg), else_=0)), 0),
            func.count(distinct(case((in_range, MilkCollection.farmer_id)))),
            func.count(distinct(case((in_range, MilkCollection.batch_id)))),
        )
        .outerjoin(MilkCollection, MilkCollection.centre_id == CollectionCentre.id)
        .group_by(CollectionCentre.id)
    )
    q = _scope(q, CollectionCentre.cooperative_id, coop)
    rows, truncated = _limit(q.order_by(CollectionCentre.name))
    out = [
        {"code": c.code, "centre": c.name, "county": c.county, "status": c.status, "has_cooler": bool(c.has_cooler),
         "accepted_kg": num(kg) or 0.0, "farmers_delivering": int(farmers or 0), "collections": int(batches or 0)}
        for c, kg, farmers, batches in rows
    ]
    return Report("centres", "Centre report", [
        ("code", "Code"), ("centre", "Centre"), ("county", "County"), ("status", "Status"), ("has_cooler", "Has cooler"),
        ("accepted_kg", "Accepted KG"), ("farmers_delivering", "Farmers delivering"), ("collections", "Collections"),
    ], out, {"centres": len(out), "accepted_kg": round(sum(r["accepted_kg"] for r in out), 2)}, truncated)


def sms_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    q = _scope(db.query(Notification).filter(Notification.created_at >= start_dt, Notification.created_at <= end_dt),
               Notification.cooperative_id, coop)
    if f.get("status"):
        q = q.filter(Notification.status == f["status"])
    rows, truncated = _limit(q.order_by(Notification.created_at.desc()))
    out = [
        {"created_at": iso(n.created_at), "type": n.type, "recipient": mask_phone(n.recipient_phone), "status": n.status,
         "attempts": n.attempts, "provider": n.provider, "sent_at": iso(n.sent_at), "error": n.error}
        for n in rows
    ]
    sent = sum(1 for r in out if r["status"] == NotificationStatus.SENT)
    failed = sum(1 for r in out if r["status"] in (NotificationStatus.FAILED, NotificationStatus.REFUNDED))
    return Report("sms", "SMS report", [
        ("created_at", "Created"), ("type", "Type"), ("recipient", "Recipient"), ("status", "Status"), ("attempts", "Attempts"),
        ("provider", "Provider"), ("sent_at", "Sent (provider accepted)"), ("error", "Error"),
    ], out, {"messages": len(out), "sent": sent, "failed": failed,
             "success_rate": round(sent / (sent + failed) * 100, 1) if (sent + failed) else None}, truncated)


def payments_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    q = (
        db.query(FarmerPayment, Farmer).join(Farmer, Farmer.id == FarmerPayment.farmer_id)
        .filter(FarmerPayment.period_end >= start, FarmerPayment.period_start <= end)
    )
    q = _scope(q, FarmerPayment.cooperative_id, coop)
    if f.get("status"):
        q = q.filter(FarmerPayment.status == f["status"])
    rows, truncated = _limit(q.order_by(FarmerPayment.period_end.desc(), Farmer.farmer_number))
    out = [
        {"reference": p.reference, "farmer_number": fa.farmer_number, "farmer": fa.full_name,
         "period": f"{iso(p.period_start)} – {iso(p.period_end)}", "kg": num(p.total_kg), "gross": num(p.gross_amount),
         "adjustments": num(p.adjustments_amount), "net": num(p.net_amount), "status": p.status,
         "payment_reference": p.payment_reference, "paid_at": iso(p.paid_at)}
        for p, fa in rows
    ]
    return Report("payments", "Farmer payment report", [
        ("reference", "Reference"), ("farmer_number", "Farmer no."), ("farmer", "Farmer"), ("period", "Period"),
        ("kg", "KG"), ("gross", "Gross"), ("adjustments", "Adjustments"), ("net", "Net"), ("status", "Status"),
        ("payment_reference", "Transaction ref."), ("paid_at", "Paid at"),
    ], out, {"payments": len(out), "net_total": round(sum(r["net"] or 0 for r in out), 2),
             "paid_total": round(sum(r["net"] or 0 for r in out if r["status"] == "PAID"), 2)}, truncated)


def pricing_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    q = _scope(db.query(MilkPrice, User.full_name).outerjoin(User, User.id == MilkPrice.created_by), MilkPrice.cooperative_id, coop)
    q = q.filter(MilkPrice.effective_from <= end, (MilkPrice.effective_to.is_(None)) | (MilkPrice.effective_to >= start))
    rows, truncated = _limit(q.order_by(MilkPrice.effective_from.desc()))
    out = [
        {"effective_from": iso(p.effective_from), "effective_to": iso(p.effective_to), "price_per_kg": num(p.price_per_kg),
         "currency": p.currency, "status": p.status, "created_by": who, "created_at": iso(p.created_at), "notes": p.notes}
        for p, who in rows
    ]
    return Report("pricing", "Milk pricing report", [
        ("effective_from", "From"), ("effective_to", "To"), ("price_per_kg", "Price / KG"), ("currency", "Currency"),
        ("status", "Status"), ("created_by", "Set by"), ("created_at", "Set at"), ("notes", "Notes"),
    ], out, {"prices": len(out)}, truncated)


def _requests_report(kind: str, request_type: str, title: str):
    def build(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
        Requester = aliased(User, name="requester")
        Reviewer = aliased(User, name="reviewer")
        start_dt = datetime.datetime.combine(start, datetime.time.min)
        end_dt = datetime.datetime.combine(end, datetime.time.max)
        q = (
            db.query(CollectionCorrectionRequest, CollectionBatch.reference, Requester.full_name, Reviewer.full_name)
            .join(CollectionBatch, CollectionBatch.id == CollectionCorrectionRequest.batch_id)
            .outerjoin(Requester, Requester.id == CollectionCorrectionRequest.requested_by)
            .outerjoin(Reviewer, Reviewer.id == CollectionCorrectionRequest.reviewed_by)
            .filter(CollectionCorrectionRequest.request_type == request_type,
                    CollectionCorrectionRequest.created_at >= start_dt, CollectionCorrectionRequest.created_at <= end_dt)
        )
        q = _scope(q, CollectionCorrectionRequest.cooperative_id, coop)
        if f.get("status"):
            q = q.filter(CollectionCorrectionRequest.status == f["status"])
        rows, truncated = _limit(q.order_by(CollectionCorrectionRequest.created_at.desc()))
        out = [
            {"created_at": iso(r.created_at), "batch": ref, "status": r.status, "reason": r.reason,
             "requested_by": requester, "reviewed_by": reviewer, "reviewed_at": iso(r.reviewed_at), "review_comment": r.review_comment,
             "original_kg": (r.original_values or {}).get("captured_weight_kg"),
             "proposed_kg": (r.proposed_values or {}).get("captured_weight_kg") if r.proposed_values else None}
            for r, ref, requester, reviewer in rows
        ]
        return Report(kind, title, [
            ("created_at", "Requested"), ("batch", "Collection"), ("status", "Status"), ("reason", "Reason"),
            ("requested_by", "Requested by"), ("reviewed_by", "Reviewed by"), ("reviewed_at", "Reviewed at"),
            ("review_comment", "Review comment"), ("original_kg", "Original KG"), ("proposed_kg", "Proposed KG"),
        ], out, {"requests": len(out), "pending": sum(1 for r in out if r["status"] == "PENDING"),
                 "approved": sum(1 for r in out if r["status"] == "APPROVED")}, truncated)
    return build


def audit_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    q = _scope(db.query(AuditLog).filter(AuditLog.created_at >= start_dt, AuditLog.created_at <= end_dt), AuditLog.cooperative_id, coop)
    if f.get("action"):
        q = q.filter(AuditLog.action == f["action"])
    rows, truncated = _limit(q.order_by(AuditLog.created_at.desc()))
    out = [
        {"created_at": iso(e.created_at), "actor": e.actor_email, "role": e.actor_role, "action": e.action,
         "entity": e.entity_type, "entity_id": e.entity_id, "target": e.target, "ip": e.ip_address}
        for e in rows
    ]
    return Report("audit", "Audit report", [
        ("created_at", "When"), ("actor", "Actor"), ("role", "Role"), ("action", "Action"), ("entity", "Entity"),
        ("entity_id", "Entity id"), ("target", "Details"), ("ip", "IP address"),
    ], out, {"entries": len(out)}, truncated)


def sync_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    q = (
        db.query(SyncMutation, Device.label, Device.device_identifier, User.email)
        .join(Device, Device.id == SyncMutation.device_id)
        .outerjoin(User, User.id == SyncMutation.user_id)
        .filter(SyncMutation.received_at >= start_dt, SyncMutation.received_at <= end_dt)
    )
    q = _scope(q, SyncMutation.cooperative_id, coop)
    if f.get("status"):
        q = q.filter(SyncMutation.status == f["status"])
    rows, truncated = _limit(q.order_by(SyncMutation.received_at.desc()))
    out = [
        {"received_at": iso(m.received_at), "device": label or (ident or "")[:8], "user": email, "entity": m.entity_type,
         "operation": m.operation, "status": m.status, "error": m.error_message, "client_time": iso(m.client_timestamp),
         "resolution": m.resolution}
        for m, label, ident, email in rows
    ]
    return Report("sync", "Sync report", [
        ("received_at", "Received"), ("device", "Device"), ("user", "User"), ("entity", "Entity"), ("operation", "Operation"),
        ("status", "Status"), ("error", "Error"), ("client_time", "Device time"), ("resolution", "Resolution"),
    ], out, {"mutations": len(out), "applied": sum(1 for r in out if r["status"] == "APPLIED"),
             "rejected": sum(1 for r in out if r["status"] == "REJECTED"),
             "conflicts": sum(1 for r in out if r["status"] == "CONFLICT")}, truncated)


def summary_report(db: Session, coop: Optional[UUID], start, end, f: dict) -> Report:
    lines = _scope(db.query(MilkCollection).filter(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end),
                   MilkCollection.cooperative_id, coop)
    accepted_kg, rejected_kg, farmers, line_count = lines.with_entities(
        func.coalesce(func.sum(case((ACCEPTED_LINE, MilkCollection.quantity_kg), else_=0)), 0),
        func.coalesce(func.sum(case((and_(EFFECTIVE_LINE, MilkCollection.quality_status == QualityStatus.REJECTED), MilkCollection.quantity_kg), else_=0)), 0),
        func.count(distinct(case((EFFECTIVE_LINE, MilkCollection.farmer_id)))),
        func.coalesce(func.sum(case((EFFECTIVE_LINE, 1), else_=0)), 0),
    ).one()
    batch_q = _scope(db.query(CollectionBatch).filter(CollectionBatch.collection_date >= start, CollectionBatch.collection_date <= end),
                     CollectionBatch.cooperative_id, coop)
    batch_n, captured, manual, reversed_n, corrected_n = batch_q.with_entities(
        func.coalesce(func.sum(case((EFFECTIVE_BATCH, 1), else_=0)), 0),
        func.coalesce(func.sum(case((EFFECTIVE_BATCH, CollectionBatch.captured_weight_kg), else_=0)), 0),
        func.coalesce(func.sum(case((and_(EFFECTIVE_BATCH, CollectionBatch.weight_source == WeightSource.MANUAL), 1), else_=0)), 0),
        func.coalesce(func.sum(case((CollectionBatch.status == BatchStatus.REVERSED, 1), else_=0)), 0),
        func.coalesce(func.sum(case((CollectionBatch.status == BatchStatus.CORRECTED, 1), else_=0)), 0),
    ).one()
    sms = sms_report(db, coop, start, end, {}).summary
    pay = payments_report(db, coop, start, end, {}).summary
    metrics = [
        ("Collections (batches)", int(batch_n or 0)), ("Allocation lines", int(line_count or 0)),
        ("Captured KG", num(captured) or 0.0), ("Accepted KG", num(accepted_kg) or 0.0), ("Rejected KG", num(rejected_kg) or 0.0),
        ("Farmers delivering", int(farmers or 0)), ("Manual weight entries", int(manual or 0)),
        ("Corrected collections", int(corrected_n or 0)), ("Reversed collections", int(reversed_n or 0)),
        ("SMS sent (provider accepted)", sms["sent"]), ("SMS failed", sms["failed"]),
        ("SMS success rate %", sms["success_rate"]), ("Farmer payments", pay["payments"]),
        ("Farmer payments net total", pay["net_total"]), ("Farmer payments paid", pay["paid_total"]),
    ]
    return Report("summary", "Cooperative summary", [("metric", "Metric"), ("value", "Value")],
                  [{"metric": m, "value": v} for m, v in metrics], {})


REPORTS: dict[str, Callable[..., Report]] = {
    "collections": collections_report,
    "farmers": farmers_report,
    "collectors": collectors_report,
    "coolers": coolers_report,
    "centres": centres_report,
    "sms": sms_report,
    "payments": payments_report,
    "pricing": pricing_report,
    "corrections": _requests_report("corrections", RequestType.CORRECTION, "Correction report"),
    "reversals": _requests_report("reversals", RequestType.REVERSAL, "Reversal report"),
    "audit": audit_report,
    "sync": sync_report,
    "summary": summary_report,
}
