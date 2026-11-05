"""The email gateway contract. Services depend only on this, never on a provider SDK."""
from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class EmailResult:
    accepted: bool                       # True only when the provider has taken responsibility for delivery
    provider_message_id: Optional[str] = None
    error: Optional[str] = None
    retryable: bool = True               # False for permanent refusals (invalid address, unverified domain...)


class EmailGatewayInterface(Protocol):
    name: str

    def send_email(self, to: str, subject: str, html: str, text: str) -> EmailResult:
        """Send one email. Must not raise for delivery problems; report them in EmailResult."""
        ...
