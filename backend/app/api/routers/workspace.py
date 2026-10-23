"""Workspace-wide helpers for cooperative users: /api/v1/search (Cmd/Ctrl+K)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies.auth import load_principal
from app.api.dependencies.db import get_db
from app.domain.exceptions import PermissionDenied
from app.domain.schemas.auth import UserRole
from app.services import search
from app.services.principal import Principal

router = APIRouter(prefix="/api/v1", tags=["Search"])


@router.get("/search")
def workspace_search(
    q: str = Query(..., min_length=2, max_length=100),
    principal: Principal = Depends(load_principal),
    db: Session = Depends(get_db),
):
    """Results only from the caller's cooperative, filtered by what their role may see. Platform staff use
    /api/v1/superadmin/search; farmers have no workspace search."""
    if principal.is_superadmin:
        return search.global_search(db, q.strip())
    if principal.role == UserRole.FARMER.value:
        raise PermissionDenied("Search isn't available for farmer accounts.")
    return search.cooperative_search(db, principal, q.strip())
