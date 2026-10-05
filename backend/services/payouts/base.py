"""The payout provider contract. services/farmer_payments.py depends only on this."""
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Protocol


@dataclass(frozen=True)
class PayoutResult:
    accepted: bool                         # the provider took the instruction (NOT that the farmer was paid)
    provider_reference: Optional[str] = None
    error: Optional[str] = None


class PayoutProvider(Protocol):
    name: str

    def initiate(self, *, payment_reference: str, method: str, account: str, amount: Decimal, currency: str) -> PayoutResult:
        """Ask the provider to pay. Must not raise for provider problems; report them in PayoutResult."""
        ...
