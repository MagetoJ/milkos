"""Cooperative onboarding applications: the review queue and approve/reject decisions."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.infrastructure.db.pagination import PageParams
from app.services.platform_admin import applications
from app.services.principal import Principal

router = APIRouter()


class ApplicationAction(BaseModel):
    action: Literal["APPROVE", "REJECT"]
    reason: Optional[str] = Field(default=None, max_length=500)


@router.get("/applications/pending")
def get_pending_applications(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return applications.pending(db)


@router.get("/applications")
def list_applications(
    application_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPROVED|REJECTED)$"),
    search: Optional[str] = Query(None, max_length=100),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    return applications.list_page(db, application_status, search, params)


@router.post("/applications/{app_id}/action")
def process_application_action(
    app_id: str,
    payload: ApplicationAction,
    db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    record, cooperative = applications.decide(db, admin, app_id, payload.action, payload.reason)
    return {
        "success": True,
        "application_id": app_id,
        "status": record.status,
        "cooperative_id": str(cooperative.id) if cooperative else None,
    }
