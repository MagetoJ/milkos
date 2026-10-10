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

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.access import Principal
from core.utils import conflict, field_error, iso, num
from models.admin import SMSCreditPackage, SMSCreditPayment
from models.cooperative import Cooperative
from schemas.platform import SmsTopUpCreate
from services import audit, inbox, sms_credits

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if payment.status not in DECIDABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This payment was already {payment.status.lower()}.")
    previous_status = payment.status

    verified = action == "VERIFY"
    coop = db.get(Cooperative, payment.cooperative_id, with_for_update=True) if payment.cooperative_id else None
    if verified and coop is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment's cooperative no longer exists. Reject it instead.")

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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not save the decision. Try again.")
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
        raise HTTPException(status.HTTP_409_CONFLICT, f"This payment was already {payment.status.lower()}.")
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if payment.status != PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Information can be requested only for a payment waiting for verification.")
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
        raise HTTPException(status.HTTP_409_CONFLICT, "No information was requested for this payment.")
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
