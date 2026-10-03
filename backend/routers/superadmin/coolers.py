from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.pagination import PageParams, apply_sort, fetch_page, page_params, page_result
from core.utils import like, parse_uuid
from db import get_db
from models.admin import Cooler
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from schemas.platform import CoolerCreate, CoolerUpdate, StatusChange
from services import coolers

router = APIRouter(prefix="/coolers")

SORTS = {
    "name": Cooler.name, "code": Cooler.code, "created_at": Cooler.created_at,
    "cooperative": Cooperative.name, "capacity_litres": Cooler.capacity_litres,
}


def list_query(db: Session):
    return (
        db.query(Cooler, Cooperative, CollectionCentre.name)
        .join(Cooperative, Cooperative.id == Cooler.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id)
    )


def serialize_rows(db: Session, rows) -> list[dict]:
    today = coolers.litres_today(db, [row[0].id for row in rows])
    return [
        coolers.cooler_json(c, cooperative=coop, centre_name=centre, litres_today=today.get(c.id, 0.0))
        for c, coop, centre in rows
    ]


def _get(db: Session, cooler_id: str) -> Cooler:
    cooler = db.get(Cooler, parse_uuid(cooler_id, "Cooler"))
    if cooler is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cooler not found")
    return cooler


def _one(db: Session, cooler: Cooler) -> dict:
    return serialize_rows(db, [list_query(db).filter(Cooler.id == cooler.id).one()])[0]


@router.get("")
def list_coolers(
    search: Optional[str] = Query(None, max_length=100),
    cooperative_id: Optional[str] = None,
    cooler_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    operational: Optional[bool] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    query = list_query(db)
    if cooperative_id:
        query = query.filter(Cooler.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if cooler_status:
        query = query.filter(Cooler.status == cooler_status)
    if operational is not None:
        query = query.filter(Cooler.is_operational.is_(operational))
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            Cooler.name.ilike(pattern, escape="\\"), Cooler.code.ilike(pattern, escape="\\"),
            Cooler.location.ilike(pattern, escape="\\"), Cooler.scale_device_id.ilike(pattern, escape="\\"),
        ))
    query = apply_sort(query, params.sort, SORTS, [Cooperative.name, Cooler.code, Cooler.id])
    rows, total = fetch_page(query, params)
    return page_result(serialize_rows(db, rows), total, params)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_cooler(payload: CoolerCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    return _one(db, coolers.create(db, admin, payload))


@router.get("/{cooler_id}")
def get_cooler(cooler_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return _one(db, _get(db, cooler_id))


@router.put("/{cooler_id}")
def update_cooler(
    cooler_id: str, payload: CoolerUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _one(db, coolers.update(db, admin, _get(db, cooler_id), payload))


@router.patch("/{cooler_id}/status")
def change_cooler_status(
    cooler_id: str, payload: StatusChange, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    return _one(db, coolers.update(db, admin, _get(db, cooler_id), CoolerUpdate(status=payload.status)))
