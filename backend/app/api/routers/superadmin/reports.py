import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.core.utils import optional_uuid
from app.services import reports
from app.services.principal import Principal

router = APIRouter(prefix="/reports")


@router.get("/collections")
def collections_report(
    cooperative_id: Optional[str] = None,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return reports.collections_report(
        db, cooperative_id=optional_uuid(cooperative_id, "Cooperative"),
        date_from=date_from, date_to=date_to,
    )
