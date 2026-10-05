"""Farmer payouts behind the PayoutProvider interface.

No payout provider ships with MilkOS: real money movement (M-Pesa B2C, bank bulk transfer) needs credentials,
a signed contract and provider-specific callback verification. Until one is configured, payments are marked
PAID only by recording the reference of a transfer a person made (services/farmer_payments.set_status).

To integrate a provider: implement PayoutProvider (services/payouts/base.py), register it in
provider_from_env, and set PAYOUT_PROVIDER. `initiate` moves a payment to PROCESSING; the provider's
confirmation (callback or status query, verified by the provider class) moves it to PAID or FAILED.
"""
import os
from typing import Optional

from services.payouts.base import PayoutProvider, PayoutResult  # noqa: F401

_override: Optional[PayoutProvider] = None
_override_set = False


def provider_from_env() -> Optional[PayoutProvider]:
    name = (os.getenv("PAYOUT_PROVIDER") or "").strip().lower()
    if not name:
        return None
    raise RuntimeError(f"Unknown PAYOUT_PROVIDER '{name}'. No payout provider is implemented yet.")


def get_provider() -> Optional[PayoutProvider]:
    return _override if _override_set else provider_from_env()


def set_provider(provider: Optional[PayoutProvider]) -> None:
    """Use `provider` instead of the environment's (tests, integrations)."""
    global _override, _override_set
    _override, _override_set = provider, True


def reset_provider() -> None:
    global _override, _override_set
    _override, _override_set = None, False
