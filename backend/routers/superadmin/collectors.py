from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, fetch_page, page_params, page_result
from core.utils import like, parse_uuid, phone_digits
from db import get_db
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.operations import Collector
from models.user import User
from schemas.platform import CollectorCreate, CollectorUpdate, StatusChange
from services import collectors

router = APIRouter(prefix="/collectors")

SORTS = {
    "name": User.full_name, "collector_number": Collector.collector_number,
    "created_at": Collector.created_at, "cooperative": Cooperative.name, "status": Collector.status,
}


def list_query(db: Session):
    return (
        db.query(Collector, User, Cooperative, CollectionCentre.name, Cooler.name)
        .join(User, User.id == Collector.user_id)
        .join(Cooperative, Cooperative.id == Collector.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Collector.centre_id)
        .outerjoin(Cooler, Cooler.id == Collector.cooler_id)
    )


def serialize_rows(db: Session, rows) -> list[dict]:
    stats = collectors.stats_for(db, [row[0].id for row in rows])
    return [
        collectors.collector_json(c, u, cooperative=coop, centre_name=centre, cooler_name=cooler, stats=stats.get(c.id))
        for c, u, coop, centre, cooler in rows
    ]


def _get(db: Session, collector_id: str) -> Collector:
    profile = db.get(Collector, parse_uuid(collector_id, "Collector"))
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collector not found")
    return profile


def _one(db: Session, profile: Collector) -> dict:
    return serialize_rows(db, [list_query(db).filter(Collector.id == profile.id).one()])[0]


@router.get("")
def list_collectors(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    collector_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = list_query(db)
    if cooperative_id:
        query = query.filter(Collector.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if cooler_id:
        query = query.filter(Collector.cooler_id == parse_uuid(cooler_id, "Cooler"))
    if collector_status:
        query = query.filter(Collector.status == collector_status)
    for term in (search or "").split():
        clauses = [
            User.full_name.ilike(like(term), escape="\\"), User.email.ilike(like(term), escape="\\"),
            Collector.collector_number.ilike(like(term), escape="\\"), Collector.assigned_area.ilike(like(term), escape="\\"),
        ]
        digits = phone_digits(term)
        if digits:
            clauses.append(User.phone_number.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))
    query = apply_sort(query, params.sort, SORTS, [User.full_name, Collector.id])
    rows, total = fetch_page(query, params)
    return page_result(serialize_rows(db, rows), total, params)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_collector(payload: CollectorCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return _one(db, collectors.create(db, admin, payload))


@router.get("/{collector_id}")
def get_collector(collector_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return _one(db, _get(db, collector_id))


@router.put("/{collector_id}")
def update_collector(
    collector_id: str, payload: CollectorUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _one(db, collectors.update(db, admin, _get(db, collector_id), payload))


@router.patch("/{collector_id}/status")
def change_collector_status(
    collector_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _one(db, collectors.update(db, admin, _get(db, collector_id), CollectorUpdate(status=payload.status)))
