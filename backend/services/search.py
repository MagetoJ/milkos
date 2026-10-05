"""Search.

global_search       superadmin: cooperatives, users, farmers, collectors, coolers, collections, batches, payments,
                    SMS transactions, applications, correction/reversal requests, devices and scale devices.
cooperative_search  cooperative workspace (Cmd/Ctrl+K): the same kinds of record, only from the caller's own
                    cooperative and only those their role may see (a collector: their own collections, farmers,
                    coolers; staff: everything of their cooperative).
"""
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal
from core.permissions import Permission
from core.utils import like, phone_digits
from models.admin import CooperativeApplication, Cooler, SMSCreditPayment
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.finance import FarmerPayment, SmsCreditTransaction
from models.operations import CollectionBatch, CollectionCorrectionRequest, Collector, MilkCollection
from models.sync import Device
from models.user import User
from schemas.auth import UserRole


def _ilike(column, pattern):
    return column.ilike(pattern, escape="\\")


def global_search(db: Session, q: str, limit: int = 5) -> dict:
    terms = q.split()
    results: list[dict] = []

    def all_terms(columns, extra_phone=None):
        clauses = []
        for term in terms:
            pattern = like(term)
            options = [_ilike(c, pattern) for c in columns]
            digits = phone_digits(term)
            if extra_phone is not None and digits:
                options.append(extra_phone.like(f"%{digits}%"))
            clauses.append(or_(*options))
        return clauses

    for coop in (
        db.query(Cooperative)
        .filter(*all_terms([Cooperative.name, Cooperative.code, Cooperative.registration_number, Cooperative.kra_pin]))
        .order_by(Cooperative.name).limit(limit)
    ):
        results.append({
            "type": "COOPERATIVE", "id": str(coop.id), "title": coop.name,
            "subtitle": coop.code, "context": f"{coop.county} · {coop.status.title()}", "cooperative_id": str(coop.id),
        })

    for user, coop_name in (
        db.query(User, Cooperative.name)
        .outerjoin(Cooperative, Cooperative.id == User.cooperative_id)
        .filter(*all_terms([User.full_name, User.email], User.phone_number))
        .order_by(User.full_name).limit(limit)
    ):
        results.append({
            "type": "USER", "id": str(user.id), "title": user.full_name, "subtitle": user.email,
            "context": " · ".join(filter(None, [user.role_value.replace("_", " ").title(), coop_name])),
            "cooperative_id": str(user.cooperative_id) if user.cooperative_id else None,
        })

    for farmer, coop_name in (
        db.query(Farmer, Cooperative.name)
        .join(Cooperative, Cooperative.id == Farmer.cooperative_id)
        .filter(*all_terms([Farmer.first_name, Farmer.last_name, Farmer.farmer_number, Farmer.national_id], Farmer.phone))
        .order_by(Farmer.last_name, Farmer.first_name).limit(limit)
    ):
        results.append({
            "type": "FARMER", "id": str(farmer.id), "title": farmer.full_name, "subtitle": farmer.farmer_number,
            "context": coop_name, "cooperative_id": str(farmer.cooperative_id),
        })

    for collector, user, coop_name in (
        db.query(Collector, User, Cooperative.name)
        .join(User, User.id == Collector.user_id)
        .join(Cooperative, Cooperative.id == Collector.cooperative_id)
        .filter(*all_terms([User.full_name, Collector.collector_number, Collector.assigned_area], User.phone_number))
        .order_by(User.full_name).limit(limit)
    ):
        results.append({
            "type": "COLLECTOR", "id": str(collector.id), "title": user.full_name, "subtitle": collector.collector_number,
            "context": coop_name, "cooperative_id": str(collector.cooperative_id),
        })

    for cooler, coop_name in (
        db.query(Cooler, Cooperative.name)
        .join(Cooperative, Cooperative.id == Cooler.cooperative_id)
        .filter(*all_terms([Cooler.name, Cooler.code, Cooler.scale_device_id, Cooler.location]))
        .order_by(Cooler.name).limit(limit)
    ):
        results.append({
            "type": "COOLER", "id": str(cooler.id), "title": cooler.name, "subtitle": cooler.code,
            "context": coop_name, "cooperative_id": str(cooler.cooperative_id),
        })

    for collection, farmer, coop_name in (
        db.query(MilkCollection, Farmer, Cooperative.name)
        .join(Farmer, Farmer.id == MilkCollection.farmer_id)
        .join(Cooperative, Cooperative.id == MilkCollection.cooperative_id)
        .filter(*all_terms([MilkCollection.reference]))
        .order_by(MilkCollection.created_at.desc()).limit(limit)
    ):
        results.append({
            "type": "COLLECTION", "id": str(collection.id), "title": collection.reference,
            "subtitle": f"{float(collection.quantity_kg):g} KG from {farmer.full_name}",
            "context": coop_name, "cooperative_id": str(collection.cooperative_id),
        })

    results += _extra_results(db, terms, None, limit, platform=True)
    return {"query": q, "results": results}


def _all_terms(terms, columns, extra_phone=None):
    clauses = []
    for term in terms:
        pattern = like(term)
        options = [_ilike(c, pattern) for c in columns]
        digits = phone_digits(term)
        if extra_phone is not None and digits:
            options.append(extra_phone.like(f"%{digits}%"))
        clauses.append(or_(*options))
    return clauses


def _scoped(query, column, cooperative_id):
    return query.filter(column == cooperative_id) if cooperative_id is not None else query


def _extra_results(db: Session, terms: list[str], cooperative_id, limit: int, *, platform: bool,
                   include_finance: bool = True, collector_id=None) -> list[dict]:
    """Batches, payments, SMS transactions, applications, requests, devices and scale devices."""
    out: list[dict] = []
    batch_q = _scoped(db.query(CollectionBatch), CollectionBatch.cooperative_id, cooperative_id).filter(
        *_all_terms(terms, [CollectionBatch.reference, CollectionBatch.scale_name, CollectionBatch.scale_identifier]))
    if collector_id is not None:
        batch_q = batch_q.filter(CollectionBatch.collector_id == collector_id)
    for b in batch_q.order_by(CollectionBatch.created_at.desc()).limit(limit):
        out.append({"type": "BATCH", "id": str(b.id), "title": b.reference,
                    "subtitle": f"{float(b.captured_weight_kg):g} KG, {b.status.replace('_', ' ').lower()}",
                    "context": b.collection_date.isoformat(), "cooperative_id": str(b.cooperative_id)})
    if collector_id is not None:
        return out
    if include_finance:
        for p, f in (
            _scoped(db.query(FarmerPayment, Farmer).join(Farmer, Farmer.id == FarmerPayment.farmer_id), FarmerPayment.cooperative_id, cooperative_id)
            .filter(*_all_terms(terms, [FarmerPayment.reference, FarmerPayment.payment_reference, Farmer.farmer_number]))
            .order_by(FarmerPayment.created_at.desc()).limit(limit)
        ):
            out.append({"type": "FARMER_PAYMENT", "id": str(p.id), "title": p.reference,
                        "subtitle": f"KES {float(p.net_amount):,.2f} to {f.full_name}", "context": p.status.title(),
                        "cooperative_id": str(p.cooperative_id)})
        for p in (
            _scoped(db.query(SMSCreditPayment), SMSCreditPayment.cooperative_id, cooperative_id)
            .filter(*[or_(_ilike(SMSCreditPayment.masked_mpesa_ref, like(t)), SMSCreditPayment.mpesa_reference == t.upper()) for t in terms])
            .order_by(SMSCreditPayment.submitted_at.desc()).limit(limit)
        ):
            out.append({"type": "SMS_PAYMENT", "id": str(p.id), "title": p.masked_mpesa_ref,
                        "subtitle": f"{p.credits_requested:,} SMS credits", "context": (p.status or "").title(),
                        "cooperative_id": str(p.cooperative_id) if p.cooperative_id else None})
        for t in (
            _scoped(db.query(SmsCreditTransaction), SmsCreditTransaction.cooperative_id, cooperative_id)
            .filter(*_all_terms(terms, [SmsCreditTransaction.reference, SmsCreditTransaction.transaction_type]))
            .order_by(SmsCreditTransaction.created_at.desc()).limit(limit)
        ):
            out.append({"type": "SMS_TRANSACTION", "id": str(t.id), "title": f"{t.transaction_type.title()} {t.amount:+,}",
                        "subtitle": t.reference, "context": t.created_at.date().isoformat() if t.created_at else "",
                        "cooperative_id": str(t.cooperative_id)})
    for r, ref in (
        _scoped(db.query(CollectionCorrectionRequest, CollectionBatch.reference)
                .join(CollectionBatch, CollectionBatch.id == CollectionCorrectionRequest.batch_id),
                CollectionCorrectionRequest.cooperative_id, cooperative_id)
        .filter(*_all_terms(terms, [CollectionBatch.reference, CollectionCorrectionRequest.reason, CollectionCorrectionRequest.request_type]))
        .order_by(CollectionCorrectionRequest.created_at.desc()).limit(limit)
    ):
        out.append({"type": r.request_type, "id": str(r.id), "title": f"{r.request_type.title()} of {ref}",
                    "subtitle": r.reason[:80], "context": r.status.title(), "cooperative_id": str(r.cooperative_id),
                    "batch_id": str(r.batch_id)})
    for d in (
        _scoped(db.query(Device), Device.cooperative_id, cooperative_id)
        .filter(*_all_terms(terms, [Device.label, Device.device_identifier, Device.platform]))
        .order_by(Device.last_seen_at.desc()).limit(limit)
    ):
        out.append({"type": "DEVICE", "id": str(d.id), "title": d.label or d.device_identifier[:12],
                    "subtitle": d.platform or "Device", "context": "Active" if d.is_active else "Deactivated",
                    "cooperative_id": str(d.cooperative_id) if d.cooperative_id else None})
    seen: set = set()
    for name, identifier, coop_id in (
        _scoped(db.query(CollectionBatch.scale_name, CollectionBatch.scale_identifier, CollectionBatch.cooperative_id),
                CollectionBatch.cooperative_id, cooperative_id)
        .filter(CollectionBatch.scale_identifier.isnot(None))
        .filter(*_all_terms(terms, [CollectionBatch.scale_name, CollectionBatch.scale_identifier]))
        .distinct().limit(limit)
    ):
        if identifier in seen:
            continue
        seen.add(identifier)
        out.append({"type": "SCALE", "id": identifier, "title": name or identifier, "subtitle": "Scale used for collections",
                    "context": identifier, "cooperative_id": str(coop_id)})
    for cooler in (
        _scoped(db.query(Cooler), Cooler.cooperative_id, cooperative_id)
        .filter(Cooler.scale_device_id.isnot(None)).filter(*_all_terms(terms, [Cooler.scale_device_id])).limit(limit)
    ):
        if cooler.scale_device_id in seen:
            continue
        seen.add(cooler.scale_device_id)
        out.append({"type": "SCALE", "id": cooler.scale_device_id, "title": cooler.scale_device_id,
                    "subtitle": f"Scale assigned to {cooler.name}", "context": cooler.code, "cooperative_id": str(cooler.cooperative_id)})
    if platform:
        for a in (
            db.query(CooperativeApplication)
            .filter(*_all_terms(terms, [CooperativeApplication.org_name, CooperativeApplication.registration_number,
                                         CooperativeApplication.email, CooperativeApplication.applicant_name]))
            .order_by(CooperativeApplication.created_at.desc()).limit(limit)
        ):
            out.append({"type": "APPLICATION", "id": str(a.id), "title": a.org_name, "subtitle": a.applicant_name,
                        "context": (a.status or "").title(), "cooperative_id": str(a.cooperative_id) if a.cooperative_id else None})
    return out


def cooperative_search(db: Session, principal: Principal, q: str, limit: int = 5) -> dict:
    terms = q.split()
    coop_id = principal.cooperative_id
    collector_id = principal.collector_profile().id if principal.role == UserRole.COLLECTOR.value else None
    staff = principal.role in (UserRole.COOP_ADMIN.value, UserRole.MANAGER.value)
    results: list[dict] = []

    if principal.can(Permission.FARMER_READ):
        columns = [Farmer.first_name, Farmer.last_name, Farmer.farmer_number] + ([Farmer.national_id] if staff else [])
        for farmer in (
            db.query(Farmer).filter(Farmer.cooperative_id == coop_id)
            .filter(*_all_terms(terms, columns, Farmer.phone))
            .order_by(Farmer.last_name, Farmer.first_name).limit(limit)
        ):
            results.append({"type": "FARMER", "id": str(farmer.id), "title": farmer.full_name, "subtitle": farmer.farmer_number,
                            "context": farmer.phone, "cooperative_id": str(coop_id)})
    if principal.can(Permission.COOLER_READ):
        for cooler in (
            db.query(Cooler).filter(Cooler.cooperative_id == coop_id)
            .filter(*_all_terms(terms, [Cooler.name, Cooler.code, Cooler.location])).order_by(Cooler.name).limit(limit)
        ):
            results.append({"type": "COOLER", "id": str(cooler.id), "title": cooler.name, "subtitle": cooler.code,
                            "context": cooler.status.title(), "cooperative_id": str(coop_id)})
    if staff:
        for centre in (
            db.query(CollectionCentre).filter(CollectionCentre.cooperative_id == coop_id)
            .filter(*_all_terms(terms, [CollectionCentre.name, CollectionCentre.code])).order_by(CollectionCentre.name).limit(limit)
        ):
            results.append({"type": "CENTRE", "id": str(centre.id), "title": centre.name, "subtitle": centre.code,
                            "context": centre.county, "cooperative_id": str(coop_id)})
        for collector, user in (
            db.query(Collector, User).join(User, User.id == Collector.user_id).filter(Collector.cooperative_id == coop_id)
            .filter(*_all_terms(terms, [User.full_name, Collector.collector_number, Collector.assigned_area], User.phone_number))
            .order_by(User.full_name).limit(limit)
        ):
            results.append({"type": "COLLECTOR", "id": str(collector.id), "title": user.full_name,
                            "subtitle": collector.collector_number, "context": collector.status.title(), "cooperative_id": str(coop_id)})
    line_q = db.query(MilkCollection, Farmer).join(Farmer, Farmer.id == MilkCollection.farmer_id).filter(
        MilkCollection.cooperative_id == coop_id).filter(*_all_terms(terms, [MilkCollection.reference]))
    if collector_id is not None:
        line_q = line_q.filter(MilkCollection.collector_id == collector_id)
    for line, farmer in line_q.order_by(MilkCollection.created_at.desc()).limit(limit):
        results.append({"type": "COLLECTION", "id": str(line.id), "title": line.reference,
                        "subtitle": f"{float(line.quantity_kg):g} KG from {farmer.full_name}", "context": line.record_status.title(),
                        "cooperative_id": str(coop_id), "batch_id": str(line.batch_id)})
    results += _extra_results(
        db, terms, coop_id, limit, platform=False,
        include_finance=staff and principal.can(Permission.FARMER_PAYMENT_READ), collector_id=collector_id,
    )
    return {"query": q, "results": results}
