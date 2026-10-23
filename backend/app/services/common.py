"""Helpers shared by the services."""
import datetime
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.utils import field_error
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.services.principal import Principal, verify_cooperative_access


@dataclass(frozen=True)
class SyncOrigin:
    """Where an offline-created record came from (services/sync/push.py).

    `entity_id` is the id the device generated, reused as the server id so later offline records that
    reference it (a collection for a farmer created offline) resolve without a mapping step.
    """
    entity_id: Optional[UUID] = None
    device_id: Optional[UUID] = None
    client_recorded_at: Optional[datetime.datetime] = None

    def id_kwargs(self) -> dict:
        return {"id": self.entity_id} if self.entity_id else {}


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
