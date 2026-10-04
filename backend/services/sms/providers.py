"""SMS provider adapters. Each is selected and configured through environment variables (see __init__.py).

No provider is enabled by default: until SMS_PROVIDER is set, notifications are stored and marked FAILED
with "SMS provider not configured" - never reported as sent.
"""
from typing import Optional

import httpx

from services.sms.base import SmsProviderError, SmsResult

TIMEOUT_SECONDS = 15.0


class AfricasTalkingProvider:
    """Africa's Talking bulk SMS API (https://developers.africastalking.com/docs/sms/sending).

    Env: AFRICASTALKING_USERNAME, AFRICASTALKING_API_KEY, optional AFRICASTALKING_SENDER_ID and
    AFRICASTALKING_SANDBOX=true (uses the sandbox endpoint; username must be "sandbox").
    """
    name = "africastalking"
    LIVE_URL = "https://api.africastalking.com/version1/messaging"
    SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging"
    ACCEPTED_CODES = {100, 101, 102}  # Processed, Sent, Queued

    def __init__(self, username: str, api_key: str, sender_id: Optional[str] = None, sandbox: bool = False,
                 client: Optional[httpx.Client] = None):
        if not username or not api_key:
            raise SmsProviderError("AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY must be set.")
        self.username = username
        self.api_key = api_key
        self.sender_id = sender_id or None
        self.url = self.SANDBOX_URL if sandbox else self.LIVE_URL
        self.client = client

    def send_sms(self, to: str, message: str) -> SmsResult:
        data = {"username": self.username, "to": to, "message": message}
        if self.sender_id:
            data["from"] = self.sender_id
        headers = {"apiKey": self.api_key, "Accept": "application/json"}
        try:
            if self.client is not None:
                res = self.client.post(self.url, data=data, headers=headers, timeout=TIMEOUT_SECONDS)
            else:
                with httpx.Client() as client:
                    res = client.post(self.url, data=data, headers=headers, timeout=TIMEOUT_SECONDS)
        except httpx.HTTPError as exc:
            return SmsResult(False, error=f"Could not reach Africa's Talking: {type(exc).__name__}")

        if res.status_code >= 500:
            return SmsResult(False, error=f"Africa's Talking error (HTTP {res.status_code})")
        if res.status_code >= 400:
            return SmsResult(False, error=f"Africa's Talking refused the request (HTTP {res.status_code})", retryable=False)
        try:
            recipients = res.json()["SMSMessageData"]["Recipients"]
            first = recipients[0]
        except (ValueError, KeyError, IndexError, TypeError):
            return SmsResult(False, error="Unexpected response from Africa's Talking")
        if int(first.get("statusCode", 0)) in self.ACCEPTED_CODES:
            return SmsResult(True, provider_message_id=first.get("messageId"))
        status = first.get("status") or "rejected"
        # 401-409 are permanent (invalid number, blacklisted, insufficient balance is 405 - retryable later).
        retryable = int(first.get("statusCode", 0)) in {405, 500, 501, 502}
        return SmsResult(False, error=f"Africa's Talking: {status}", retryable=retryable)


class WebhookSmsProvider:
    """Posts {"to", "message"} as JSON to an HTTP endpoint you control (an SMS gateway, a modem bridge...).

    Env: SMS_WEBHOOK_URL, optional SMS_WEBHOOK_TOKEN (sent as a Bearer token). A 2xx response means
    accepted; a JSON body may carry "message_id".
    """
    name = "webhook"

    def __init__(self, url: str, token: Optional[str] = None, client: Optional[httpx.Client] = None):
        if not url:
            raise SmsProviderError("SMS_WEBHOOK_URL must be set.")
        self.url = url
        self.token = token
        self.client = client

    def send_sms(self, to: str, message: str) -> SmsResult:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        payload = {"to": to, "message": message}
        try:
            if self.client is not None:
                res = self.client.post(self.url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
            else:
                with httpx.Client() as client:
                    res = client.post(self.url, json=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        except httpx.HTTPError as exc:
            return SmsResult(False, error=f"Could not reach the SMS gateway: {type(exc).__name__}")
        if 200 <= res.status_code < 300:
            message_id = None
            try:
                body = res.json()
                message_id = body.get("message_id") if isinstance(body, dict) else None
            except ValueError:
                pass
            return SmsResult(True, provider_message_id=message_id)
        return SmsResult(False, error=f"SMS gateway answered HTTP {res.status_code}", retryable=res.status_code >= 500)
