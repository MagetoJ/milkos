"""Collection centres: one implementation for the cooperative workspace and offline sync."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import conflict, field_error, iso, next_sequence, num, reject_nulls
from models.centre import CollectionCentre
from models.farmer import Farmer
from models.user import User
from schemas.auth import UserRole
from schemas.cooperative_module import CentreCreate, CentreUpdate
from services import audit
from services.common import SyncOrigin

CODE_TAKEN = "Another centre in your cooperative already uses this code."


def centre_json(centre: CollectionCentre, farmer_count: int = 0, manager_name: Optional[str] = None) -> dict:
    return {
        "id": str(centre.id),
        "name": centre.name,
        "code": centre.code,
        "county": centre.county,
        "location_description": centre.location_description,
        "manager_user_id": str(centre.manager_user_id) if centre.manager_user_id else None,
        "manager_name": manager_name,
        "has_cooler": bool(centre.has_cooler),
        "cooler_capacity_litres": num(centre.cooler_capacity_litres),
        "status": centre.status,
        "farmer_count": farmer_count,
        "sync_version": centre.sync_version,
        "created_at": iso(centre.created_at),
    }


def manager_names(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.full_name for u in db.query(User).filter(User.id.in_(ids)).all()}


def farmer_counts(db: Session, cooperative_id: UUID, centre_ids: Optional[list[UUID]] = None) -> dict:
    query = db.query(Farmer.centre_id, func.count(Farmer.id)).filter(
        Farmer.cooperative_id == cooperative_id, Farmer.status == "ACTIVE", Farmer.centre_id.isnot(None)
    )
    if centre_ids is not None:
        query = query.filter(Farmer.centre_id.in_(centre_ids))
    return dict(query.group_by(Farmer.centre_id).all())


def serialize(db: Session, centres: list[CollectionCentre]) -> list[dict]:
    if not centres:
        return []
    counts = farmer_counts(db, centres[0].cooperative_id, [c.id for c in centres])
    names = manager_names(db, {c.manager_user_id for c in centres})
    return [centre_json(c, counts.get(c.id, 0), names.get(c.manager_user_id)) for c in centres]


def check_manager(db: Session, cooperative_id: UUID, manager_user_id: Optional[UUID]) -> None:
    if manager_user_id is None:
        return
    manager = db.get(User, manager_user_id)
    if (
        manager is None
        or manager.cooperative_id != cooperative_id
        or manager.role_value != UserRole.MANAGER.value
        or not manager.is_active
    ):
        raise field_error("manager_user_id", "Choose an active manager from your team.")


def code_taken(db: Session, cooperative_id: UUID, code: str, exclude_id: Optional[UUID] = None) -> bool:
    query = db.query(CollectionCentre.id).filter(
        CollectionCentre.cooperative_id == cooperative_id, CollectionCentre.code == code
    )
    if exclude_id:
        query = query.filter(CollectionCentre.id != exclude_id)
    return query.first() is not None


def create(
    db: Session, principal: Principal, payload: CentreCreate, origin: Optional[SyncOrigin] = None,
) -> CollectionCentre:
    cooperative = principal.cooperative
    check_manager(db, cooperative.id, payload.manager_user_id)
    explicit_code = payload.code is not None

    for attempt in range(3):
        code = payload.code or next_sequence(
            (row[0] for row in db.query(CollectionCentre.code).filter(CollectionCentre.cooperative_id == cooperative.id)),
            "CTR", 3,
        )
        if code_taken(db, cooperative.id, code):
            raise conflict("code", CODE_TAKEN)
        centre = CollectionCentre(
            **(origin.id_kwargs() if origin else {}),
            cooperative_id=cooperative.id,
            name=payload.name,
            code=code,
            county=payload.county or cooperative.county,
            location_description=payload.location_description,
            manager_user_id=payload.manager_user_id,
            has_cooler=payload.has_cooler,
            cooler_capacity_litres=payload.cooler_capacity_litres if payload.has_cooler else None,
            status="ACTIVE",
        )
        db.add(centre)
        try:
            db.flush()
            audit.record(
                db, principal, "CENTRE_CREATED", target=f"{centre.name} ({centre.code})",
                entity_type="centre", entity_id=centre.id, cooperative_id=cooperative.id,
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            if explicit_code or attempt == 2:
                raise conflict("code", CODE_TAKEN)
            continue
        db.refresh(centre)
        return centre
    raise conflict("code", "Could not allocate a centre code. Try again.")  # pragma: no cover


def update(db: Session, principal: Principal, centre: CollectionCentre, payload: CentreUpdate) -> CollectionCentre:
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "name", "code", "county", "has_cooler", "status")

    if "manager_user_id" in data:
        check_manager(db, centre.cooperative_id, data["manager_user_id"])
    if "code" in data and code_taken(db, centre.cooperative_id, data["code"], exclude_id=centre.id):
        raise conflict("code", CODE_TAKEN)

    for name, value in data.items():
        setattr(centre, name, value)
    if not centre.has_cooler:
        centre.cooler_capacity_litres = None
    if data:
        audit.record(
            db, principal, "CENTRE_UPDATED", target=f"{centre.name} ({centre.code})",
            entity_type="centre", entity_id=centre.id, cooperative_id=centre.cooperative_id,
            new_values={k: (str(v) if isinstance(v, UUID) else v) for k, v in data.items()},
        )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("code", CODE_TAKEN)
    db.refresh(centre)
    return centre
