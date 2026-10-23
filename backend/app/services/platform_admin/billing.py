"""SMS credit payments awaiting or past verification, and the SMS credit packages on sale."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.utils import changed, like, num, parse_uuid, reject_nulls, snapshot
from app.domain.exceptions import NotFound, ValidationFailed
from app.domain.schemas.platform import SmsPackageCreate, SmsPackageUpdate
from app.infrastructure.db.models.admin import SMSCreditPackage, SMSCreditPayment
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.pagination import PageParams, apply_sort, paginate
from app.services import audit, payments
from app.services.platform_admin import overview
from app.services.principal import Principal, get_or_404

# ---------------- payments ----------------

PAYMENT_SORTS = {
    "submitted_at": SMSCreditPayment.submitted_at, "amount_kes": SMSCreditPayment.amount_kes,
    "credits_requested": SMSCreditPayment.credits_requested, "cooperative": Cooperative.name,
}
PAYMENT_STATUSES = ("PENDING", "AWAITING_INFORMATION", "VERIFIED", "REJECTED", "CANCELLED")


def _payments(db: Session):
    return (
        db.query(SMSCreditPayment, Cooperative, SMSCreditPackage)
        .outerjoin(Cooperative, Cooperative.id == SMSCreditPayment.cooperative_id)
        .outerjoin(SMSCreditPackage, SMSCreditPackage.id == SMSCreditPayment.package_id)
    )


def _payment_row(row) -> dict:
    return payments.payment_json(*row)


def pending_payments(db: Session) -> list[dict]:
    rows = _payments(db).filter(SMSCreditPayment.status == "PENDING").order_by(SMSCreditPayment.submitted_at.asc()).all()
    return [_payment_row(row) for row in rows]


def payments_page(db: Session, status: Optional[str], cooperative_id: Optional[UUID], search: Optional[str],
                  params: PageParams) -> dict:
    query = _payments(db)
    if status:
        query = query.filter(SMSCreditPayment.status == status)
    if cooperative_id:
        query = query.filter(SMSCreditPayment.cooperative_id == cooperative_id)
    for term in (search or "").split():
        pattern = like(term)
        query = query.filter(or_(
            Cooperative.name.ilike(pattern, escape="\\"), Cooperative.code.ilike(pattern, escape="\\"),
            SMSCreditPayment.masked_mpesa_ref.ilike(pattern, escape="\\"),
            # A full M-Pesa code finds its payment without ever echoing the stored code back.
            SMSCreditPayment.mpesa_reference == term.upper(),
        ))
    totals = dict(
        (s, (n, num(kes) or 0.0))
        for s, n, kes in db.query(
            SMSCreditPayment.status, func.count(SMSCreditPayment.id), func.coalesce(func.sum(SMSCreditPayment.amount_kes), 0)
        ).group_by(SMSCreditPayment.status)
    )
    result = paginate(
        apply_sort(query, params.sort, PAYMENT_SORTS, [SMSCreditPayment.submitted_at.desc(), SMSCreditPayment.id]),
        params, _payment_row,
    )
    result["summary"] = {
        key.lower(): {"count": totals.get(key, (0, 0.0))[0], "amount_kes": totals.get(key, (0, 0.0))[1]}
        for key in PAYMENT_STATUSES
    }
    return result


def payment_detail(db: Session, payment_id: str) -> dict:
    pid = parse_uuid(payment_id, "Payment")
    row = _payments(db).filter(SMSCreditPayment.id == pid).first()
    if row is None:
        raise NotFound("Payment")
    return {**_payment_row(row), "activity": overview.entity_history(db, "payment", pid)}


def decide_payment(db: Session, admin: Principal, payment_id: str, action: str, reason: Optional[str]) -> SMSCreditPayment:
    reason = (reason or "").strip() or None
    if action == "REJECT" and (reason is None or len(reason) < 5):
        raise ValidationFailed("Give a reason (at least 5 characters) when rejecting.")
    return payments.decide(db, admin, parse_uuid(payment_id, "Payment"), action, reason)


# ---------------- packages ----------------

PACKAGE_FIELDS = ("name", "credits_amount", "price_kes", "is_active")


def package_json(p: SMSCreditPackage) -> dict:
    return {
        "id": str(p.id), "name": p.name, "credits_amount": p.credits_amount,
        "price_kes": num(p.price_kes), "is_active": bool(p.is_active),
    }


def list_packages(db: Session) -> list[dict]:
    return [package_json(p) for p in db.query(SMSCreditPackage).order_by(SMSCreditPackage.credits_amount).all()]


def create_package(db: Session, admin: Principal, payload: SmsPackageCreate) -> dict:
    package = SMSCreditPackage(**payload.model_dump())
    db.add(package)
    db.flush()
    audit.record(
        db, admin, "SMS_PACKAGE_CREATED", target=f"{package.name}: {package.credits_amount:,} credits for KES {payload.price_kes:,.0f}",
        entity_type="sms_package", entity_id=package.id, new_values=payload.model_dump(),
    )
    db.commit()
    db.refresh(package)
    return package_json(package)


def update_package(db: Session, admin: Principal, package_id: str, payload: SmsPackageUpdate) -> dict:
    package = get_or_404(db, SMSCreditPackage, package_id, "Package")
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, *PACKAGE_FIELDS)
    before = snapshot(package, PACKAGE_FIELDS)
    for name, value in data.items():
        setattr(package, name, value)
    old, new = changed(before, snapshot(package, PACKAGE_FIELDS))
    if new:
        audit.record(
            db, admin, "SMS_PACKAGE_UPDATED", target=package.name, entity_type="sms_package", entity_id=package.id,
            old_values=old, new_values=new,
        )
        db.commit()
    db.refresh(package)
    return package_json(package)
