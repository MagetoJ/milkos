"""SMS credit payments (M-Pesa top-ups) awaiting or past verification."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.permissions import Permission
from app.core.utils import optional_uuid, parse_uuid
from app.domain.schemas.platform import PaymentDecision
from app.infrastructure.db.pagination import PageParams
from app.services import payments
from app.services.platform_admin import billing
from app.services.principal import Principal

router = APIRouter(prefix="/payments")


@router.get("/pending")
def get_pending_payments(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return billing.pending_payments(db)


@router.get("")
def list_payments(
    payment_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|AWAITING_INFORMATION|VERIFIED|REJECTED|CANCELLED)$"),
    cooperative_id: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=100),
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _: Principal = Depends(require_superadmin),
):
    coop = optional_uuid(cooperative_id, "Cooperative")
    return billing.payments_page(db, payment_status, coop, search, params)


@router.get("/{payment_id}")
def get_payment(payment_id: str, db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return billing.payment_detail(db, payment_id)


@router.post("/{payment_id}/action")
def decide_payment(
    payment_id: str, payload: PaymentDecision, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    admin.require(Permission.PAYMENT_VERIFY if payload.action == "VERIFY" else Permission.PAYMENT_REJECT)
    payment = billing.decide_payment(db, admin, payment_id, payload.action, payload.reason)
    return {"success": True, "payment_id": payment_id, "status": payment.status}


class InformationRequest(BaseModel):
    message: str = Field(..., min_length=5, max_length=1000)


@router.post("/{payment_id}/request-information")
def request_payment_information(
    payment_id: str, payload: InformationRequest, db: Session = Depends(get_db),
    admin: Principal = Depends(require_superadmin),
):
    """Pending -> Awaiting information. The cooperative is notified and answers from its SMS credits page."""
    admin.require(Permission.PAYMENT_VERIFY)
    payment = payments.request_information(db, admin, parse_uuid(payment_id, "Payment"), payload.message.strip())
    return {"success": True, "payment_id": payment_id, "status": payment.status}
