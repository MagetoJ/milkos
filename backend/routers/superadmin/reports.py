import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.utils import parse_uuid
from db import get_db
from services import reports

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
        db, cooperative_id=parse_uuid(cooperative_id, "Cooperative") if cooperative_id else None,
        date_from=date_from, date_to=date_to,
    )
