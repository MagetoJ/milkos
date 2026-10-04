"""The SMS provider contract. Business logic (services/notifications.py) depends only on this."""
from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class SmsResult:
    accepted: bool                       # True only when the provider has taken responsibility for delivery
    provider_message_id: Optional[str] = None
    error: Optional[str] = None
    retryable: bool = True               # False for permanent refusals (invalid number, blacklisted...)


class SmsProvider(Protocol):
    name: str

    def send_sms(self, to: str, message: str) -> SmsResult:
        """Send one SMS to an E.164 number. Must not raise for delivery problems; report them in SmsResult."""
        ...


class SmsProviderError(RuntimeError):
    """Misconfiguration detected while building a provider (missing credentials, unknown name)."""
