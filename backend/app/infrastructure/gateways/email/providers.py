"""Email provider adapters. Selected and configured through environment variables (see __init__.py)."""

import httpx

from app.domain.interfaces.email import EmailResult
from app.domain.interfaces.sms import GatewayConfigurationError

TIMEOUT_SECONDS = 15.0


class ResendProvider:
    """Resend (https://resend.com/docs/api-reference/emails/send-email).

    Env: RESEND_API_KEY, EMAIL_FROM (an address on a domain verified in Resend, e.g. "MilkOS <no-reply@milkos.app>").
    Until a domain is verified, Resend only delivers from onboarding@resend.dev to the account owner's own address.
    """
    name = "resend"
    URL = "https://api.resend.com/emails"

    def __init__(self, api_key: str, sender: str, client: httpx.Client | None = None):
        if not api_key or not sender:
            raise GatewayConfigurationError("RESEND_API_KEY and EMAIL_FROM must be set.")
        self.api_key = api_key
        self.sender = sender
        self.client = client

    def send_email(self, to: str, subject: str, html: str, text: str) -> EmailResult:
        body = {"from": self.sender, "to": [to], "subject": subject, "html": html, "text": text}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            if self.client is not None:
                res = self.client.post(self.URL, json=body, headers=headers, timeout=TIMEOUT_SECONDS)
            else:
                with httpx.Client() as client:
                    res = client.post(self.URL, json=body, headers=headers, timeout=TIMEOUT_SECONDS)
        except httpx.HTTPError as exc:
            return EmailResult(False, error=f"Could not reach Resend: {type(exc).__name__}")

        if res.status_code == 429 or res.status_code >= 500:
            return EmailResult(False, error=f"Resend error (HTTP {res.status_code})")
        if res.status_code >= 400:
            try:
                detail = res.json().get("message")
            except ValueError:
                detail = None
            return EmailResult(False, error=f"Resend refused the email (HTTP {res.status_code}){': ' + detail if detail else ''}",
                               retryable=False)
        try:
            return EmailResult(True, provider_message_id=res.json().get("id"))
        except ValueError:
            return EmailResult(False, error="Unexpected response from Resend")
