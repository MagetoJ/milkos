"""Collection reports over a date range, for the whole platform or one cooperative."""
import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, distinct, func
from sqlalchemy.orm import Session

from core.utils import iso, num
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import MilkCollection, QualityStatus

MAX_DAYS = 366


def resolve_range(date_from: Optional[datetime.date], date_to: Optional[datetime.date]) -> tuple[datetime.date, datetime.date]:
    today = datetime.datetime.utcnow().date()
    end = date_to or today
    start = date_from or end - datetime.timedelta(days=29)
    if start > end:
        raise HTTPException(422, "The start date must be on or before the end date.")
    if (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(422, f"Choose a range of at most {MAX_DAYS} days.")
    return start, end


def collections_report(
    db: Session, *, cooperative_id: Optional[UUID], date_from: Optional[datetime.date], date_to: Optional[datetime.date],
) -> dict:
    start, end = resolve_range(date_from, date_to)
    accepted = MilkCollection.quality_status == QualityStatus.ACCEPTED
    rejected = MilkCollection.quality_status == QualityStatus.REJECTED
    litres = MilkCollection.quantity_litres

    def scoped(query):
        query = query.filter(MilkCollection.collection_date >= start, MilkCollection.collection_date <= end)
        if cooperative_id is not None:
            query = query.filter(MilkCollection.cooperative_id == cooperative_id)
        return query

    totals = scoped(db.query(
        func.count(MilkCollection.id),
        func.coalesce(func.sum(case((accepted, litres), else_=0)), 0),
        func.coalesce(func.sum(case((rejected, litres), else_=0)), 0),
        func.coalesce(func.sum(case((rejected, 1), else_=0)), 0),
        func.count(distinct(MilkCollection.farmer_id)),
        func.avg(case((accepted, MilkCollection.fat_percentage))),
        func.avg(case((accepted, MilkCollection.snf_percentage))),
    )).one()

    daily_rows = {
        day: (a, r, n)
        for day, a, r, n in scoped(db.query(
            MilkCollection.collection_date,
            func.coalesce(func.sum(case((accepted, litres), else_=0)), 0),
            func.coalesce(func.sum(case((rejected, litres), else_=0)), 0),
            func.count(MilkCollection.id),
        )).group_by(MilkCollection.collection_date).all()
    }
    daily = []
    day = start
    while day <= end:
        a, r, n = daily_rows.get(day, (0, 0, 0))
        daily.append({"date": iso(day), "accepted_litres": num(a) or 0.0, "rejected_litres": num(r) or 0.0, "collections": n})
        day += datetime.timedelta(days=1)

    by_coop = scoped(
        db.query(
            Cooperative.id, Cooperative.name, Cooperative.code,
            func.coalesce(func.sum(case((accepted, litres), else_=0)), 0),
            func.coalesce(func.sum(case((rejected, litres), else_=0)), 0),
            func.count(MilkCollection.id),
            func.count(distinct(MilkCollection.farmer_id)),
            func.avg(case((accepted, MilkCollection.fat_percentage))),
        ).join(MilkCollection, MilkCollection.cooperative_id == Cooperative.id)
    ).group_by(Cooperative.id, Cooperative.name, Cooperative.code).order_by(
        func.sum(case((accepted, litres), else_=0)).desc()
    ).all()

    top_farmers = scoped(
        db.query(
            Farmer.id, Farmer.first_name, Farmer.last_name, Farmer.farmer_number, Cooperative.name,
            func.sum(litres), func.count(MilkCollection.id),
        )
        .join(MilkCollection, MilkCollection.farmer_id == Farmer.id)
        .join(Cooperative, Cooperative.id == Farmer.cooperative_id)
        .filter(accepted)
    ).group_by(Farmer.id, Farmer.first_name, Farmer.last_name, Farmer.farmer_number, Cooperative.name).order_by(
        func.sum(litres).desc()
    ).limit(10).all()

    count, acc, rej, rej_n, farmers, fat, snf = totals
    return {
        "range": {"from": iso(start), "to": iso(end), "days": (end - start).days + 1},
        "cooperative_id": str(cooperative_id) if cooperative_id else None,
        "totals": {
            "collections": count or 0,
            "accepted_litres": num(acc) or 0.0,
            "rejected_litres": num(rej) or 0.0,
            "rejected_collections": int(rej_n or 0),
            "farmers_delivering": farmers or 0,
            "average_fat_percentage": round(float(fat), 2) if fat is not None else None,
            "average_snf_percentage": round(float(snf), 2) if snf is not None else None,
            "average_daily_litres": round((num(acc) or 0.0) / ((end - start).days + 1), 2),
        },
        "daily": daily,
        "by_cooperative": [
            {
                "id": str(cid), "name": name, "code": code, "accepted_litres": num(a) or 0.0,
                "rejected_litres": num(r) or 0.0, "collections": n, "farmers_delivering": f,
                "average_fat_percentage": round(float(fat_avg), 2) if fat_avg is not None else None,
            }
            for cid, name, code, a, r, n, f, fat_avg in by_coop
        ],
        "top_farmers": [
            {
                "id": str(fid), "full_name": f"{first} {last}", "farmer_number": number, "cooperative_name": coop_name,
                "accepted_litres": num(total) or 0.0, "collections": n,
            }
            for fid, first, last, number, coop_name, total, n in top_farmers
        ],
    }
