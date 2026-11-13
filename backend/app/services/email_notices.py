"""Account and applicant emails. They go out IN ADDITION to the SMS and never replace it.

Everything here is best effort: a missing provider, a bad address or a provider outage is logged and reported
in the return value, but never raises, so an email problem can't fail or undo the request that caused it.
The one-time links are sent but never logged or stored.
"""
import logging
from html import escape

from app.domain.interfaces.email import EmailResult
from app.domain.interfaces.sms import GatewayConfigurationError
from app.infrastructure.gateways import email as email_gateway

logger = logging.getLogger("milkflow.email")


def _button(url: str, label: str) -> str:
    return (
        f'<p style="margin:28px 0"><a href="{escape(url, quote=True)}" style="background:#059669;color:#fff;padding:12px 24px;'
        f'border-radius:6px;font-weight:bold;font-size:14px;text-decoration:none;display:inline-block">{escape(label)}</a></p>'
        f'<p style="color:#6b7280;font-size:12px;line-height:1.4">If the button does not work, copy this link into your browser:<br>'
        f'<a href="{escape(url, quote=True)}" style="color:#059669">{escape(url)}</a></p>'
    )


def _wrap(title: str, body_html: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;background:#f9fafb;padding:40px 20px"><div style="max-width:560px;margin:0 auto;'
        'background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">'
        f'<h1 style="font-size:20px;color:#111827;margin:0 0 16px">{escape(title)}</h1>'
        f'<div style="color:#4b5563;font-size:15px;line-height:1.5">{body_html}</div></div></div>'
    )


def activation_email(full_name: str, cooperative: str | None, link: str, expiry: str) -> dict:
    where = f" for {cooperative}" if cooperative else ""
    subject = f"Activate your MilkOS account{where}"
    text = (f"Hello {full_name},\n\nYour MilkOS account{where} has been created. Activate it here: {link}\n"
            f"This link expires in {expiry}.\n\nIf you weren't expecting this, you can ignore this email.")
    html = _wrap("Welcome to MilkOS", f"<p>Hello <strong>{escape(full_name)}</strong>,</p>"
                 f"<p>Your MilkOS account{escape(where)} has been created. Activate it to choose your password.</p>"
                 f"{_button(link, 'Activate account')}<p>This link expires in {escape(expiry)}. "
                 "If you weren't expecting this, you can ignore this email.</p>")
    return {"subject": subject, "text": text, "html": html}


def reset_email(full_name: str, link: str, minutes: int) -> dict:
    text = (f"Hello {full_name},\n\nReset your MilkOS password here: {link}\nThe link expires in {minutes} minutes.\n\n"
            "If you didn't ask for this, ignore this email.")
    html = _wrap("Reset your MilkOS password", f"<p>Hello <strong>{escape(full_name)}</strong>,</p>"
                 f"<p>Use the button below to choose a new password.</p>{_button(link, 'Reset password')}"
                 f"<p>The link expires in {minutes} minutes. If you didn't ask for this, ignore this email.</p>")
    return {"subject": "Reset your MilkOS password", "text": text, "html": html}


_APPLICANT = {
    "APPLICATION_RECEIVED": ("We received your MilkOS application",
                             ("Thank you for applying. We received your application and will review it shortly. "
                             "You can check its status any time with your reference and this email address.")),
    "APPLICATION_APPROVED": ("Your MilkOS application was approved",
                             ("Good news: your application has been approved. The account administrator will receive an SMS "
                             "with a link to activate their account.")),
    "APPLICATION_REJECTED": ("Update on your MilkOS application",
                             ("We reviewed your application and are not able to approve it at this time. "
                             "Sign in to the application status page for details.")),
}


def applicant_email(event: str, org_name: str) -> dict | None:
    if event not in _APPLICANT:
        return None
    subject, message = _APPLICANT[event]
    text = f"Hello {org_name},\n\n{message}\n\nMilkOS"
    html = _wrap(subject, f"<p>Hello <strong>{escape(org_name)}</strong>,</p><p>{escape(message)}</p>")
    return {"subject": subject, "text": text, "html": html}


def send(to: str | None, message: dict | None, *, kind: str) -> EmailResult | None:
    """Send one prepared email. Returns None when nothing was attempted (no address, no message, no provider)."""
    if not to or not message:
        return None
    try:
        provider = email_gateway.get_provider()
    except GatewayConfigurationError:
        logger.exception("email_misconfigured kind=%s", kind)
        return None
    if provider is None:
        logger.info("email_skipped kind=%s reason=no_provider_configured", kind)
        return None
    try:
        result = provider.send_email(to, message["subject"], message["html"], message["text"])
    except Exception:  # an email problem must never fail the request that caused it
        logger.exception("email_failed kind=%s", kind)
        return EmailResult(False, error="Unexpected error while sending the email")
    if result.accepted:
        logger.info("email_sent kind=%s provider=%s id=%s", kind, provider.name, result.provider_message_id)
    else:
        logger.warning("email_not_sent kind=%s provider=%s error=%s retryable=%s", kind, provider.name, result.error, result.retryable)
    return result
