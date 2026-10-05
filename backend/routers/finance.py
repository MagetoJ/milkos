"""Cooperative finance: SMS Credit Center, milk pricing and farmer payments (/api/v1/cooperative/...).

Every endpoint works on the caller's own cooperative (from the database, never the request). Ledger
balances are computed from sms_credit_transactions; nothing here lets a client set a balance.

  COOP_ADMIN  everything
  MANAGER     read the credit center, prices and payments
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from core.access import Principal, ensure_same_cooperative, require_permission
from core.pagination import PageParams, fetch_page, page_params, page_result
from core.permissions import Permission
from core.utils import iso, like, num, parse_uuid
from db import get_db
from models.admin import SMSCreditPackage, SMSCreditPayment
from models.farmer import Farmer
from models.finance import (
    AdjustmentStatus, FarmerPayment, FarmerPaymentAdjustment, MilkPrice, SmsCreditTransaction,
)
from models.notifications import Notification, NotificationStatus
from models.user import User
from schemas.finance import Cancellation, PaymentGenerate, PaymentStatusChange, PriceCreate, SmsSettingsUpdate
from services import audit, farmer_payments, payments, pricing, sms_credits

router = APIRouter(prefix="/api/v1/cooperative", tags=["Cooperative finance"])


def _coop(principal: Principal) -> Principal:
    if principal.cooperative is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
    return principal


# ---------------- SMS credit center ----------------

def sms_health(db: Session, cooperative_id, days: int = 30) -> dict:
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    counts = dict(
        db.query(Notification.status, func.count(Notification.id))
        .filter(Notification.cooperative_id == cooperative_id, Notification.created_at >= since)
        .group_by(Notification.status).all()
    )
    sent = counts.get(NotificationStatus.SENT, 0)
    failed = counts.get(NotificationStatus.FAILED, 0) + counts.get(NotificationStatus.REFUNDED, 0)
    waiting = sum(counts.get(s, 0) for s in (
        NotificationStatus.PENDING, NotificationStatus.PENDING_PROVIDER, NotificationStatus.RESERVED, NotificationStatus.SENDING,
    ))
    attempted = sent + failed
    return {
        "days": days, "sent": sent, "failed": failed, "waiting": waiting,
        "pending_provider": counts.get(NotificationStatus.PENDING_PROVIDER, 0),
        "skipped": counts.get(NotificationStatus.SKIPPED, 0),
        "success_rate": round(sent / attempted * 100, 1) if attempted else None,
        "by_status": counts,
    }


@router.get("/sms-credits/center")
def sms_credit_center(
    params: PageParams = Depends(page_params),
    transaction_type: Optional[str] = Query(None, alias="type", pattern="^(PURCHASE|ADJUSTMENT|RESERVED|CONSUMED|REFUNDED|EXPIRY)$"),
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_READ)),
    db: Session = Depends(get_db),
):
    """Balances derived from the ledger, recent ledger entries, payments, packages and SMS delivery health."""
    coop = _coop(principal).cooperative
    query = (
        db.query(SmsCreditTransaction, User.email)
        .outerjoin(User, User.id == SmsCreditTransaction.actor_user_id)
        .filter(SmsCreditTransaction.cooperative_id == coop.id)
    )
    if transaction_type:
        query = query.filter(SmsCreditTransaction.transaction_type == transaction_type)
    rows, total = fetch_page(query.order_by(SmsCreditTransaction.created_at.desc(), SmsCreditTransaction.id), params)
    packages = db.query(SMSCreditPackage).filter(SMSCreditPackage.is_active.is_(True)).order_by(SMSCreditPackage.credits_amount).all()
    history = (
        db.query(SMSCreditPayment, SMSCreditPackage)
        .outerjoin(SMSCreditPackage, SMSCreditPackage.id == SMSCreditPayment.package_id)
        .filter(SMSCreditPayment.cooperative_id == coop.id)
        .order_by(SMSCreditPayment.submitted_at.desc()).limit(50).all()
    )
    return {
        "balances": sms_credits.balances(db, coop.id),
        "transactions": page_result([sms_credits.transaction_json(t, email) for t, email in rows], total, params),
        "packages": [
            {"id": str(p.id), "name": p.name, "credits_amount": p.credits_amount, "price_kes": num(p.price_kes)}
            for p in packages
        ],
        "payments": [payments.payment_json(p, coop, pkg) for p, pkg in history],
        "health": sms_health(db, coop.id),
        "settings": {"receipt_sms_enabled": bool(coop.receipt_sms_enabled), "alert_sms_enabled": bool(coop.alert_sms_enabled)},
        "can_purchase": principal.can(Permission.SMS_CREDIT_PURCHASE),
        "payment_instructions": (
            "Pay through M-Pesa, then enter the confirmation code. Credits are added only after the platform "
            "team verifies the payment against the M-Pesa statement."
        ),
    }


@router.post("/sms-credits/payments/{payment_id}/cancel")
def cancel_sms_payment(
    payment_id: str, payload: Cancellation,
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_PURCHASE)),
    db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    payment = ensure_same_cooperative(principal, db.get(SMSCreditPayment, parse_uuid(payment_id, "Payment")), "Payment")
    payment = payments.cancel(db, principal, payment, payload.reason)
    package = db.get(SMSCreditPackage, payment.package_id) if payment.package_id else None
    return payments.payment_json(payment, coop, package)


@router.patch("/sms-settings")
def update_sms_settings(
    payload: SmsSettingsUpdate,
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_PURCHASE)),
    db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    old = {k: bool(getattr(coop, k)) for k in data}
    for key, value in data.items():
        setattr(coop, key, value)
    if any(old[k] != data[k] for k in data):
        audit.record(
            db, principal, "SMS_SETTINGS_UPDATED", target=", ".join(f"{k}={v}" for k, v in data.items()),
            entity_type="cooperative", entity_id=coop.id, cooperative_id=coop.id, old_values=old, new_values=data,
        )
    db.commit()
    return {"receipt_sms_enabled": bool(coop.receipt_sms_enabled), "alert_sms_enabled": bool(coop.alert_sms_enabled)}


@router.get("/sms-messages")
def list_sms_messages(
    params: PageParams = Depends(page_params),
    message_type: Optional[str] = Query(None, alias="type", max_length=40),
    message_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|PENDING_PROVIDER|RESERVED|SENDING|SENT|FAILED|REFUNDED|SKIPPED)$"),
    principal: Principal = Depends(require_permission(Permission.SMS_CREDIT_READ)),
    db: Session = Depends(get_db),
):
    from services import notifications

    coop = _coop(principal).cooperative
    query = db.query(Notification).filter(Notification.cooperative_id == coop.id)
    if message_type:
        query = query.filter(Notification.type == message_type)
    if message_status:
        query = query.filter(Notification.status == message_status)
    rows, total = fetch_page(query.order_by(Notification.created_at.desc(), Notification.id), params)
    return page_result([notifications.notification_json(n) for n in rows], total, params)


# ---------------- milk pricing ----------------

@router.get("/prices")
def list_prices(
    principal: Principal = Depends(require_permission(Permission.PRICING_READ)), db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    rows = db.query(MilkPrice).filter(MilkPrice.cooperative_id == coop.id).order_by(MilkPrice.effective_from.desc(), MilkPrice.created_at.desc()).all()
    used = pricing.used_ids(db, [p.id for p in rows])
    today = datetime.datetime.utcnow().date()
    current = pricing.applicable(db, coop.id, today)
    return {
        "items": [pricing.price_json(p, p.id in used) for p in rows],
        "current": pricing.price_json(current, current.id in used) if current else None,
        "can_manage": principal.can(Permission.PRICING_MANAGE),
    }


@router.get("/prices/applicable")
def applicable_price(
    date: datetime.date,
    principal: Principal = Depends(require_permission(Permission.PRICING_READ)), db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    price = pricing.applicable(db, coop.id, date)
    return {"date": iso(date), "price": pricing.price_json(price) if price else None}


@router.post("/prices", status_code=status.HTTP_201_CREATED)
def create_price(
    payload: PriceCreate,
    principal: Principal = Depends(require_permission(Permission.PRICING_MANAGE)), db: Session = Depends(get_db),
):
    _coop(principal)
    return pricing.price_json(pricing.create(db, principal, payload))


@router.post("/prices/{price_id}/cancel")
def cancel_price(
    price_id: str, payload: Cancellation,
    principal: Principal = Depends(require_permission(Permission.PRICING_MANAGE)), db: Session = Depends(get_db),
):
    _coop(principal)
    price = ensure_same_cooperative(principal, db.get(MilkPrice, parse_uuid(price_id, "Price")), "Price")
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
    coop = _coop(principal).cooperative
    query = db.query(FarmerPayment, Farmer).join(Farmer, Farmer.id == FarmerPayment.farmer_id).filter(FarmerPayment.cooperative_id == coop.id)
    if payment_status:
        query = query.filter(FarmerPayment.status == payment_status)
    if farmer_id:
        query = query.filter(FarmerPayment.farmer_id == parse_uuid(farmer_id, "Farmer"))
    if period_start:
        query = query.filter(FarmerPayment.period_end >= period_start)
    if period_end:
        query = query.filter(FarmerPayment.period_start <= period_end)
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            FarmerPayment.reference.ilike(pattern, escape="\\"), FarmerPayment.payment_reference.ilike(pattern, escape="\\"),
            Farmer.first_name.ilike(pattern, escape="\\"), Farmer.last_name.ilike(pattern, escape="\\"),
            Farmer.farmer_number.ilike(pattern, escape="\\"),
        ))
    totals = dict(
        (s, (n, num(amount) or 0.0)) for s, n, amount in query.with_entities(
            FarmerPayment.status, func.count(FarmerPayment.id), func.coalesce(func.sum(FarmerPayment.net_amount), 0),
        ).group_by(FarmerPayment.status).order_by(None)
    )
    rows, total = fetch_page(query.order_by(FarmerPayment.period_end.desc(), Farmer.last_name, FarmerPayment.id), params)
    result = page_result([farmer_payments.payment_json(p, f) for p, f in rows], total, params)
    result["summary"] = {
        s.lower(): {"count": totals.get(s, (0, 0.0))[0], "amount": totals.get(s, (0, 0.0))[1]}
        for s in ("PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED")
    }
    result["pending_adjustments"] = db.query(func.count(FarmerPaymentAdjustment.id)).filter(
        FarmerPaymentAdjustment.cooperative_id == coop.id, FarmerPaymentAdjustment.status == AdjustmentStatus.PENDING,
    ).scalar() or 0
    result["can_manage"] = principal.can(Permission.FARMER_PAYMENT_MANAGE)
    from services import payouts

    result["payout_provider"] = getattr(payouts.get_provider(), "name", None)
    return result


@router.post("/farmer-payments/preview")
def preview_farmer_payments(
    payload: PaymentGenerate,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    return farmer_payments.preview(db, coop.id, payload.period_start, payload.period_end, payload.farmer_ids)


@router.post("/farmer-payments/generate", status_code=status.HTTP_201_CREATED)
def generate_farmer_payments(
    payload: PaymentGenerate,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    _coop(principal)
    return farmer_payments.generate(db, principal, payload.period_start, payload.period_end, payload.farmer_ids)


@router.get("/farmer-payments/adjustments")
def list_adjustments(
    adjustment_status: Optional[str] = Query(None, alias="status", pattern="^(PENDING|APPLIED|CANCELLED)$"),
    params: PageParams = Depends(page_params),
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    coop = _coop(principal).cooperative
    query = db.query(FarmerPaymentAdjustment).filter(FarmerPaymentAdjustment.cooperative_id == coop.id)
    if adjustment_status:
        query = query.filter(FarmerPaymentAdjustment.status == adjustment_status)
    rows, total = fetch_page(query.order_by(FarmerPaymentAdjustment.created_at.desc(), FarmerPaymentAdjustment.id), params)
    return page_result([farmer_payments.adjustment_json(a) for a in rows], total, params)


def _payment(db: Session, principal: Principal, raw_id: str) -> FarmerPayment:
    return ensure_same_cooperative(principal, db.get(FarmerPayment, parse_uuid(raw_id, "Payment")), "Payment")


@router.get("/farmer-payments/{payment_id}")
def get_farmer_payment(
    payment_id: str,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_READ)), db: Session = Depends(get_db),
):
    _coop(principal)
    return farmer_payments.detail_json(db, _payment(db, principal, payment_id))


@router.post("/farmer-payments/{payment_id}/status")
def change_farmer_payment_status(
    payment_id: str, payload: PaymentStatusChange,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    _coop(principal)
    payment = farmer_payments.set_status(
        db, principal, _payment(db, principal, payment_id), payload.status, payload.payment_reference, payload.reason,
    )
    return farmer_payments.detail_json(db, payment)


@router.post("/farmer-payments/{payment_id}/initiate")
def initiate_farmer_payment(
    payment_id: str,
    principal: Principal = Depends(require_permission(Permission.FARMER_PAYMENT_MANAGE)), db: Session = Depends(get_db),
):
    _coop(principal)
    return farmer_payments.detail_json(db, farmer_payments.initiate(db, principal, _payment(db, principal, payment_id)))


