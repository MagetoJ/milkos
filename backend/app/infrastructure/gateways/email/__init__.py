"""Email delivery behind app.domain.interfaces.EmailGatewayInterface.

    EMAIL_PROVIDER=resend    RESEND_API_KEY, EMAIL_FROM
    (unset)                  no provider: emails are skipped (SMS still goes out), never reported as sent

Tests and other providers can be plugged in with set_provider().
"""
import os
from typing import Optional

from app.domain.interfaces.email import EmailGatewayInterface
from app.domain.interfaces.sms import GatewayConfigurationError

_override: EmailGatewayInterface | None = None
_override_set = False


def provider_from_env() -> EmailGatewayInterface | None:
    from app.infrastructure.gateways.email.providers import ResendProvider

    name = (os.getenv("EMAIL_PROVIDER") or "").strip().lower()
    if not name:
        return None
    if name == "resend":
        return ResendProvider(api_key=os.getenv("RESEND_API_KEY", ""), sender=os.getenv("EMAIL_FROM", ""))
    raise GatewayConfigurationError(f"Unknown EMAIL_PROVIDER '{name}'. Use 'resend'.")


def get_provider() -> EmailGatewayInterface | None:
    """The configured provider, or None. A misconfigured provider raises GatewayConfigurationError."""
    if _override_set:
        return _override
    return provider_from_env()


def set_provider(provider: EmailGatewayInterface | None) -> None:
    global _override, _override_set
    _override, _override_set = provider, True


def reset_provider() -> None:
    global _override, _override_set
    _override, _override_set = None, False
