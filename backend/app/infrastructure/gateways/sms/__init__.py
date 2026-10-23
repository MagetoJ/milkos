"""SMS delivery behind app.domain.interfaces.SMSGatewayInterface.

    SMS_PROVIDER=africastalking   AFRICASTALKING_USERNAME, AFRICASTALKING_API_KEY, [AFRICASTALKING_SENDER_ID],
                                  [AFRICASTALKING_SANDBOX=true]
    SMS_PROVIDER=webhook          SMS_WEBHOOK_URL, [SMS_WEBHOOK_TOKEN]
    (unset)                       no provider: notifications are kept and marked FAILED "not configured"

Tests and other providers can be plugged in with set_provider().
"""
import os
from typing import Optional

from app.domain.interfaces.sms import GatewayConfigurationError, SMSGatewayInterface

_override: Optional[SMSGatewayInterface] = None
_override_set = False


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def provider_from_env() -> Optional[SMSGatewayInterface]:
    from app.infrastructure.gateways.sms.providers import AfricasTalkingProvider, WebhookSmsProvider

    name = (os.getenv("SMS_PROVIDER") or "").strip().lower()
    if not name:
        return None
    if name == "africastalking":
        return AfricasTalkingProvider(
            username=os.getenv("AFRICASTALKING_USERNAME", ""),
            api_key=os.getenv("AFRICASTALKING_API_KEY", ""),
            sender_id=os.getenv("AFRICASTALKING_SENDER_ID"),
            sandbox=_truthy(os.getenv("AFRICASTALKING_SANDBOX")),
        )
    if name == "webhook":
        return WebhookSmsProvider(url=os.getenv("SMS_WEBHOOK_URL", ""), token=os.getenv("SMS_WEBHOOK_TOKEN"))
    raise GatewayConfigurationError(f"Unknown SMS_PROVIDER '{name}'. Use 'africastalking' or 'webhook'.")


def get_provider() -> Optional[SMSGatewayInterface]:
    """The configured provider, or None. A misconfigured provider raises GatewayConfigurationError."""
    if _override_set:
        return _override
    return provider_from_env()


def set_provider(provider: Optional[SMSGatewayInterface]) -> None:
    """Use `provider` instead of the environment's (tests, alternative integrations)."""
    global _override, _override_set
    _override, _override_set = provider, True


def reset_provider() -> None:
    global _override, _override_set
    _override, _override_set = None, False
