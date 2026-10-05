"""Workspace-wide helpers for cooperative users: /api/v1/search (Cmd/Ctrl+K)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.access import Principal, load_principal
from db import get_db
from schemas.auth import UserRole
from services import search

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
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Search isn't available for farmer accounts.")
    return search.cooperative_search(db, principal, q.strip())
