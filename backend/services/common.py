"""Helpers shared by the services."""
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal, verify_cooperative_access
from core.utils import field_error
from models.centre import CollectionCentre
from models.cooperative import Cooperative


def target_cooperative(db: Session, principal: Principal, requested: Optional[UUID]) -> Cooperative:
    """The cooperative a new record will belong to.

    Superadmin: must name one (it must exist). Everyone else: always their own; naming another is refused.
    """
    if principal.is_superadmin:
        if requested is None:
            raise field_error("cooperative_id", "Choose a cooperative.")
        cooperative = db.get(Cooperative, requested)
        if cooperative is None:
            raise field_error("cooperative_id", "This cooperative doesn't exist.")
        return cooperative
    verify_cooperative_access(principal, requested)
    return principal.cooperative


def check_centre(db: Session, cooperative_id: UUID, centre_id: Optional[UUID]) -> Optional[CollectionCentre]:
    if centre_id is None:
        return None
    centre = db.get(CollectionCentre, centre_id)
    if centre is None or centre.cooperative_id != cooperative_id:
        raise field_error("centre_id", "Choose a collection centre from the same cooperative.")
    return centre


def commit_or_conflict(db: Session, message: str, field: Optional[str] = None) -> None:
    from core.utils import conflict

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict(field, message)


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
