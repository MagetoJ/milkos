"""SMS credit top-ups paid by M-Pesa: submitted by a cooperative, verified or rejected by the superadmin.

    PENDING --verified by platform staff--> VERIFIED   (a PURCHASE entry in the SMS credit ledger)
       |-----rejected by platform staff---> REJECTED
       |-----information requested-------> AWAITING_INFORMATION --cooperative answers--> PENDING (again)
       |                                          '--verified / rejected directly------> VERIFIED / REJECTED
       '-----withdrawn by the cooperative--> CANCELLED

Nothing here talks to M-Pesa: the cooperative reports a confirmation code and platform staff check it
against the till statement. Only VERIFIED adds credits, in the same transaction as the decision and its
audit entry; the ledger's unique (payment, PURCHASE) entry means a payment can never be credited twice.
"""
import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.utils import conflict, field_error, iso, num
from app.domain.exceptions import Conflict, NotFound, OperationFailed
from app.domain.schemas.platform import SmsTopUpCreate
from app.infrastructure.db.models.admin import SMSCreditPackage, SMSCreditPayment
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.finance import SmsCreditTransaction
from app.infrastructure.db.models.user import User
from app.infrastructure.db.pagination import PageParams, fetch_page, page_result
from app.services import audit, inbox, notifications, sms_credits
from app.services.principal import Principal

PENDING, VERIFIED, REJECTED, CANCELLED = "PENDING", "VERIFIED", "REJECTED", "CANCELLED"
AWAITING_INFORMATION = "AWAITING_INFORMATION"
DECIDABLE = (PENDING, AWAITING_INFORMATION)


def mask_reference(reference: str) -> str:
    if len(reference) <= 5:
        return "•" * len(reference)
    return reference[:3] + "•" * (len(reference) - 5) + reference[-2:]


def payment_json(payment: SMSCreditPayment, coop: Optional[Cooperative], package: Optional[SMSCreditPackage]) -> dict:
    return {
        "id": str(payment.id),
        "cooperative_id": str(payment.cooperative_id) if payment.cooperative_id else None,
        "cooperative_name": coop.name if coop else None,
        "cooperative_code": coop.code if coop else None,
        "package_id": str(payment.package_id) if payment.package_id else None,
        "package_name": package.name if package else None,
        "amount_kes": num(payment.amount_kes),
        "credits_requested": int(payment.credits_requested),
        "masked_mpesa_ref": payment.masked_mpesa_ref,
        "status": payment.status,
        "rejection_reason": payment.rejection_reason,
        "submitted_at": iso(payment.submitted_at),
        "verified_at": iso(payment.verified_at),
        "info_request": payment.info_request,
        "info_requested_at": iso(payment.info_requested_at),
        "info_response": payment.info_response,
        "info_responded_at": iso(payment.info_responded_at),
    }


def decide(db: Session, principal: Principal, payment_id: UUID, action: str, reason: Optional[str]) -> SMSCreditPayment:
    payment = db.get(SMSCreditPayment, payment_id, with_for_update=True)
    if not payment:
        raise NotFound("Payment")
    if payment.status not in DECIDABLE:
        raise Conflict(f"This payment was already {payment.status.lower()}.")
    previous_status = payment.status

    verified = action == "VERIFY"
    coop = db.get(Cooperative, payment.cooperative_id, with_for_update=True) if payment.cooperative_id else None
    if verified and coop is None:
        raise Conflict("This payment's cooperative no longer exists. Reject it instead.")

    target = (
        f"{int(payment.credits_requested):,} credits, KES {float(payment.amount_kes):,.0f}, "
        f"ref {payment.masked_mpesa_ref}" + (f" for {coop.name}" if coop else "")
    )
    old_values = {"status": previous_status}
    new_values: dict = {}
    payment.verified_by = principal.user.id
    payment.verified_at = datetime.datetime.utcnow()
    if verified:
        before = sms_credits.available(db, coop.id)
        sms_credits.purchase(
            db, coop.id, int(payment.credits_requested), payment.id, principal.user.id,
            details={"amount_kes": float(payment.amount_kes), "masked_mpesa_ref": payment.masked_mpesa_ref},
        )
        payment.status = VERIFIED
        old_values["sms_credit_balance"] = before
        new_values = {"status": VERIFIED, "sms_credit_balance": sms_credits.available(db, coop.id)}
    else:
        payment.status = REJECTED
        payment.rejection_reason = reason
        new_values = {"status": REJECTED}
    audit.record(
        db, principal, "PAYMENT_VERIFIED" if verified else "PAYMENT_REJECTED", target=target,
        entity_type="payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values=old_values, new_values=new_values, reason=reason,
    )
    if payment.cooperative_id:
        inbox.notify(
            db, cooperative_id=payment.cooperative_id, roles=("COOP_ADMIN",), category="PAYMENT",
            type="SMS_PAYMENT_VERIFIED" if verified else "SMS_PAYMENT_REJECTED",
            severity="INFO" if verified else "WARNING",
            title=(f"{int(payment.credits_requested):,} SMS credits added" if verified
                   else f"SMS credit payment {payment.masked_mpesa_ref} was rejected"),
            body=None if verified else reason, entity_type="payment", entity_id=payment.id,
            link="/cooperatives/sms-credits",
        )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise OperationFailed("Could not save the decision. Try again.")
    db.refresh(payment)
    return payment


def submit(db: Session, principal: Principal, payload: SmsTopUpCreate) -> SMSCreditPayment:
    """A cooperative reports an M-Pesa payment for SMS credits (it stays PENDING until verified)."""
    coop = principal.cooperative
    package = None
    if payload.package_id is not None:
        package = db.get(SMSCreditPackage, payload.package_id)
        if package is None or not package.is_active:
            raise field_error("package_id", "Choose an available package.")
        credits, amount = int(package.credits_amount), float(package.price_kes)
    else:
        if not payload.credits or not payload.amount_kes:
            raise field_error("credits", "Choose a package, or enter the credits and the amount paid.")
        credits, amount = payload.credits, payload.amount_kes

    if db.query(SMSCreditPayment.id).filter(SMSCreditPayment.mpesa_reference == payload.mpesa_reference).first():
        raise conflict("mpesa_reference", "This M-Pesa code has already been submitted.")

    payment = SMSCreditPayment(
        cooperative_id=coop.id, package_id=package.id if package else None, amount_kes=amount,
        credits_requested=credits, mpesa_reference=payload.mpesa_reference,
        masked_mpesa_ref=mask_reference(payload.mpesa_reference), status=PENDING, submitted_by=principal.user.id,
    )
    db.add(payment)
    db.flush()
    audit.record(
        db, principal, "PAYMENT_SUBMITTED",
        target=f"{credits:,} credits, KES {amount:,.0f}, ref {payment.masked_mpesa_ref} for {coop.name}",
        entity_type="payment", entity_id=payment.id, cooperative_id=coop.id,
        new_values={"credits": credits, "amount_kes": amount},
    )
    inbox.platform(
        db, category="PAYMENT", type="SMS_PAYMENT_SUBMITTED", title=f"{coop.name} submitted an SMS credit payment",
        body=f"{credits:,} credits, KES {amount:,.0f}, ref {payment.masked_mpesa_ref}. Verify it against the M-Pesa statement.",
        entity_type="payment", entity_id=payment.id, link="/superadmin/payments",
    )
    db.commit()
    db.refresh(payment)
    return payment


def cancel(db: Session, principal: Principal, payment: SMSCreditPayment, reason: Optional[str]) -> SMSCreditPayment:
    """The cooperative withdraws a payment it submitted that hasn't been reviewed yet."""
    payment = db.get(SMSCreditPayment, payment.id, with_for_update=True)
    if payment.status != PENDING:
        raise Conflict(f"This payment was already {payment.status.lower()}.")
    payment.status = CANCELLED
    payment.rejection_reason = reason
    audit.record(
        db, principal, "PAYMENT_CANCELLED",
        target=f"{int(payment.credits_requested):,} credits, ref {payment.masked_mpesa_ref}",
        entity_type="payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values={"status": PENDING}, new_values={"status": CANCELLED}, reason=reason,
    )
    db.commit()
    db.refresh(payment)
    return payment


def request_information(db: Session, principal: Principal, payment_id: UUID, message: str) -> SMSCreditPayment:
    """Platform staff ask the cooperative for more (e.g. the till statement line). Nothing is credited or refused."""
    payment = db.get(SMSCreditPayment, payment_id, with_for_update=True)
    if not payment:
        raise NotFound("Payment")
    if payment.status != PENDING:
        raise Conflict("Information can be requested only for a payment waiting for verification.")
    payment.status = AWAITING_INFORMATION
    payment.info_request = message
    payment.info_requested_by = principal.user.id
    payment.info_requested_at = datetime.datetime.utcnow()
    payment.info_response = None
    payment.info_responded_by = None
    payment.info_responded_at = None
    audit.record(
        db, principal, "PAYMENT_INFO_REQUESTED", target=f"Payment {payment.masked_mpesa_ref}",
        entity_type="payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values={"status": PENDING}, new_values={"status": AWAITING_INFORMATION, "requested_information": message},
    )
    if payment.cooperative_id:
        inbox.notify(
            db, cooperative_id=payment.cooperative_id, roles=("COOP_ADMIN",), category="PAYMENT",
            type="SMS_PAYMENT_INFO_REQUESTED", severity="WARNING",
            title=f"More information needed for SMS credit payment {payment.masked_mpesa_ref}",
            body=message, entity_type="payment", entity_id=payment.id, link="/cooperatives/sms-credits",
        )
    db.commit()
    db.refresh(payment)
    return payment


def respond_information(db: Session, principal: Principal, payment: SMSCreditPayment, response: str) -> SMSCreditPayment:
    """The cooperative answers; the payment goes back to the verification queue."""
    if payment.status != AWAITING_INFORMATION:
        raise Conflict("No information was requested for this payment.")
    payment.status = PENDING
    payment.info_response = response
    payment.info_responded_by = principal.user.id
    payment.info_responded_at = datetime.datetime.utcnow()
    audit.record(
        db, principal, "PAYMENT_INFO_PROVIDED", target=f"Payment {payment.masked_mpesa_ref}",
        entity_type="payment", entity_id=payment.id, cooperative_id=payment.cooperative_id,
        old_values={"status": AWAITING_INFORMATION}, new_values={"status": PENDING, "response": response},
    )
    inbox.platform(
        db, category="PAYMENT", type="SMS_PAYMENT_INFO_PROVIDED", title=f"Information provided for payment {payment.masked_mpesa_ref}",
        body=response[:300], entity_type="payment", entity_id=payment.id, link="/superadmin/payments",
    )
    db.commit()
    db.refresh(payment)
    return payment


def with_package_json(db: Session, payment: SMSCreditPayment, coop: Optional[Cooperative]) -> dict:
    package = db.get(SMSCreditPackage, payment.package_id) if payment.package_id else None
    return payment_json(payment, coop, package)


def _packages_and_payments(db: Session, coop: Cooperative) -> dict:
    packages = db.query(SMSCreditPackage).filter(SMSCreditPackage.is_active.is_(True)).order_by(SMSCreditPackage.credits_amount).all()
    history = (
        db.query(SMSCreditPayment, SMSCreditPackage)
        .outerjoin(SMSCreditPackage, SMSCreditPackage.id == SMSCreditPayment.package_id)
        .filter(SMSCreditPayment.cooperative_id == coop.id)
        .order_by(SMSCreditPayment.submitted_at.desc())
        .limit(50)
        .all()
    )
    return {
        "packages": [
            {"id": str(p.id), "name": p.name, "credits_amount": p.credits_amount, "price_kes": num(p.price_kes)}
            for p in packages
        ],
        "payments": [payment_json(p, coop, pkg) for p, pkg in history],
    }


def credit_overview(db: Session, coop: Cooperative) -> dict:
    """The cooperative's SMS credit balance, the packages on sale and its last 50 payments."""
    return {"balance": sms_credits.available(db, coop.id), **_packages_and_payments(db, coop)}


PAYMENT_INSTRUCTIONS = (
    "Pay through M-Pesa, then enter the confirmation code. Credits are added only after the platform "
    "team verifies the payment against the M-Pesa statement."
)


def credit_center(db: Session, coop: Cooperative, transaction_type: Optional[str], params: PageParams) -> dict:
    """Balances derived from the ledger, recent ledger entries, payments, packages and SMS delivery health."""
    query = (
        db.query(SmsCreditTransaction, User.email)
        .outerjoin(User, User.id == SmsCreditTransaction.actor_user_id)
        .filter(SmsCreditTransaction.cooperative_id == coop.id)
    )
    if transaction_type:
        query = query.filter(SmsCreditTransaction.transaction_type == transaction_type)
    rows, total = fetch_page(query.order_by(SmsCreditTransaction.created_at.desc(), SmsCreditTransaction.id), params)
    return {
        "balances": sms_credits.balances(db, coop.id),
        "transactions": page_result([sms_credits.transaction_json(t, email) for t, email in rows], total, params),
        **_packages_and_payments(db, coop),
        "health": notifications.delivery_health(db, coop.id),
        "settings": {"receipt_sms_enabled": bool(coop.receipt_sms_enabled), "alert_sms_enabled": bool(coop.alert_sms_enabled)},
        "payment_instructions": PAYMENT_INSTRUCTIONS,
    }
