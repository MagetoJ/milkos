"""
Applicant notifications: an email to the address on the application (received / approved / rejected).
Without an email provider configured (EMAIL_PROVIDER unset) it only logs, as before.

Call it after the change has been committed, so nobody is told about a decision that was rolled back.
"""
import logging
from typing import Literal

from app.services import email_notices

logger = logging.getLogger("milkflow.notifications")

ApplicantEvent = Literal["APPLICATION_RECEIVED", "APPLICATION_APPROVED", "APPLICATION_REJECTED"]


def notify_applicant(application, event: ApplicantEvent) -> None:
    try:
        logger.info(
            "notify_applicant event=%s application=%s org=%r email=%s phone=%s",
            event, application.id, application.org_name, application.email, application.phone,
        )
        email_notices.send(application.email, email_notices.applicant_email(event, application.org_name), kind=event)
    except Exception:  # a notification problem must never undo or fail the request
        logger.exception("notify_applicant failed for event=%s", event)
