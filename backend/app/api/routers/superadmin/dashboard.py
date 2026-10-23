from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.services import dashboard, search
from app.services.platform_admin import overview
from app.services.principal import Principal

router = APIRouter()


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return dashboard.summary(db)


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    """Compact headline numbers (kept for older clients; /dashboard has the full picture)."""
    return overview.headline_counts(db)


@router.get("/search")
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return search.global_search(db, q.strip(), limit)
