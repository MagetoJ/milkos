"""
Applicant notifications. Only logs for now; SMS/email delivery plugs in here later.

Call it after the change has been committed, so nobody is told about a decision that was rolled back.
"""
import logging
from typing import Literal

logger = logging.getLogger("milkflow.notifications")

ApplicantEvent = Literal["APPLICATION_RECEIVED", "APPLICATION_APPROVED", "APPLICATION_REJECTED"]


def notify_applicant(application, event: ApplicantEvent) -> None:
    try:
        logger.info(
            "notify_applicant event=%s application=%s org=%r email=%s phone=%s",
            event, application.id, application.org_name, application.email, application.phone,
        )
    except Exception:  # a notification problem must never undo or fail the request
        logger.exception("notify_applicant failed for event=%s", event)
