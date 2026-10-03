"""Superadmin global search across cooperatives, users, farmers, collectors, coolers and collections."""
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.utils import like, phone_digits
from models.admin import Cooler
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector, MilkCollection
from models.user import User


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
            "subtitle": f"{float(collection.quantity_litres):g} L from {farmer.full_name}",
            "context": coop_name, "cooperative_id": str(collection.cooperative_id),
        })

    return {"query": q, "results": results}
