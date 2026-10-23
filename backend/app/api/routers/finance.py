"""Cooperative finance: SMS Credit Center, milk pricing and farmer payments (/api/v1/cooperative/...).

Every endpoint works on the caller's own cooperative (from the database, never the request). Ledger
balances are computed from sms_credit_transactions; nothing here lets a client set a balance.

  COOP_ADMIN  everything
  MANAGER     read the credit center, prices and payments
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_permission
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.permissions import Permission
from app.core.utils import iso, optional_uuid
from app.domain.schemas.finance import (
    Cancellation, PaymentGenerate, PaymentStatusChange, PriceCreate, SmsSettingsUpdate,
)
from app.infrastructure.db.models.admin import SMSCreditPayment
from app.infrastructure.db.models.finance import FarmerPayment, MilkPrice
from app.infrastructure.db.pagination import PageParams
from app.services import cooperatives, farmer_payments, notifications, payments, pricing
from app.services.principal import Principal, own

router = APIRouter(prefix="/api/v1/cooperative", tags=["Cooperative finance"])


# ---------------- SMS credit center ----------------

@router.get("/sms-credits/center")
def sms_credit_center(
    params: PageParams = Depends(page_params),
    transaction_type: Optional[str] = Query(None, alias="type", pattern="^(PURCHASE|ADJUSTMENT|RESERVED|CONSUMED|REFUNDED|EXPIRY)$"),
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_READ)),
    db: Session = Depends(get_db),
):
    """Balances derived from the ledger, recent ledger entries, payments, packages and SMS delivery health."""
    center = payments.credit_center(db, principal.require_tenant().cooperative, transaction_type, params)
    center["can_purchase"] = principal.can(Permission.SMS_CREDIT_PURCHASE)
    return center


@router.post("/sms-credits/payments/{payment_id}/cancel")
def cancel_sms_payment(
    payment_id: str, payload: Cancellation,
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_PURCHASE)),
    db: Session = Depends(get_db),
):
    coop = principal.require_tenant().cooperative
    payment = payments.cancel(db, principal, own(db, principal, SMSCreditPayment, payment_id, "Payment"), payload.reason)
    return payments.with_package_json(db, payment, coop)


@router.patch("/sms-settings")
def update_sms_settings(
    payload: SmsSettingsUpdate,
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_PURCHASE)),
    db: Session = Depends(get_db),
):
    coop = principal.require_tenant().cooperative
    return cooperatives.update_sms_settings(db, principal, coop, payload.model_dump(exclude_unset=True, exclude_none=True))


@router.get("/sms-messages")
def list_sms_messages(
    params: PageParams = Depends(page_params),
    message_type: Optional[str] = Query(None, alias="type", max_length=40),
    message_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|PENDING_PROVIDER|RESERVED|SENDING|SENT|FAILED|REFUNDED|SKIPPED)$"),
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_READ)),
    db: Session = Depends(get_db),
):
    return notifications.list_page(db, principal.require_tenant().cooperative.id, message_status, params, type=message_type)


# ---------------- milk pricing ----------------

@router.get("/prices")
def list_prices(
    principal: Principal = Depends(require_permission(Permission.PRICING_READ)), db: Session = Depends(get_db),
):
    result = pricing.overview(db, principal.require_tenant().cooperative.id)
    result["can_manage"] = principal.can(Permission.PRICING_MANAGE)
    return result


@router.get("/prices/applicable")
def applicable_price(
    date: datetime.date,
    principal: Principal = Depends(require_permission(Permission.PRICING_READ)), db: Session = Depends(get_db),
):
    price = pricing.applicable(db, principal.require_tenant().cooperative.id, date)
    return {"date": iso(date), "price": pricing.price_json(price) if price else None}


@router.post("/prices", status_code=status.HTTP_201_CREATED)
def create_price(
    payload: PriceCreate,
    principal: Principal = Depends(require_permission(Permission.PRICING_MANAGE)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    return pricing.price_json(pricing.create(db, principal, payload))


@router.post("/prices/{price_id}/cancel")
def cancel_price(
    price_id: str, payload: Cancellation,
    principal: Principal = Depends(require_permission(Permission.PRICING_MANAGE)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    price = own(db, principal, MilkPrice, price_id, "Price")
    return pricing.price_json(pricing.cancel(db, principal, price, payload.reason))


# ---------------- farmer payments ----------------

PAYMENT_STATUSES = "^(PENDING|PROCESSING|PAID|FAILED|CANCELLED)$"


@router.get("/farmer-payments")
def list_farmer_payments(
    search: Optional[str] = Query(None, max_length=100),
    payment_status: Optional[str] = Query(None, alias="status", pattern=PAYMENT_STATUSES),
    farmer_id: Optional[str] = None,
    period_start: Optional[datetime.date] = None,
    period_end: Optional[datetime.date] = None,
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)),
    db: Session = Depends(get_db),
):
    result = farmer_payments.list_page(
        db, principal.require_tenant().cooperative.id, search=search, status=payment_status,
        farmer_id=optional_uuid(farmer_id, "Farmer"),
        period_start=period_start, period_end=period_end, params=params,
    )
    result["can_manage"] = principal.can(Permission.FARMER_PAYMENT_MANAGE)
    return result


@router.post("/farmer-payments/preview")
def preview_farmer_payments(
    payload: PaymentGenerate,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    coop = principal.require_tenant().cooperative
    return farmer_payments.preview(db, coop.id, payload.period_start, payload.period_end, payload.farmer_ids)


@router.post("/farmer-payments/generate", status_code=status.HTTP_201_CREATED)
def generate_farmer_payments(
    payload: PaymentGenerate,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    return farmer_payments.generate(db, principal, payload.period_start, payload.period_end, payload.farmer_ids)


@router.get("/farmer-payments/adjustments")
def list_adjustments(
    adjustment_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPLIED|CANCELLED)$"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    return farmer_payments.adjustments_page(db, principal.require_tenant().cooperative.id, adjustment_status, params)


def _payment(db: Session, principal: Principal, raw_id: str) -> FarmerPayment:
    return own(db, principal, FarmerPayment, raw_id, "Payment")


@router.get("/farmer-payments/{payment_id}")
def get_farmer_payment(
    payment_id: str,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    return farmer_payments.detail_json(db, _payment(db, principal, payment_id))


@router.post("/farmer-payments/{payment_id}/status")
def change_farmer_payment_status(
    payment_id: str, payload: PaymentStatusChange,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    payment = farmer_payments.set_status(
        db, principal, _payment(db, principal, payment_id), payload.status, payload.payment_reference, payload.reason,
    )
    return farmer_payments.detail_json(db, payment)


@router.post("/farmer-payments/{payment_id}/initiate")
def initiate_farmer_payment(
    payment_id: str,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    principal.require_tenant()
    return farmer_payments.detail_json(db, farmer_payments.initiate(db, principal, _payment(db, principal, payment_id)))
