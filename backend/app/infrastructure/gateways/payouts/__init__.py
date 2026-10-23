"""Farmer payouts behind app.domain.interfaces.PaymentGatewayInterface.

No payout provider ships with MilkOS: real money movement (M-Pesa B2C, bank bulk transfer) needs credentials,
a signed contract and provider-specific callback verification. Until one is configured, payments are marked
PAID only by recording the reference of a transfer a person made (services/farmer_payments.set_status).

To integrate a provider: implement app.domain.interfaces.PaymentGatewayInterface (in app/infrastructure/gateways/payouts/), register it in
get_provider, and set PAYOUT_PROVIDER. `initiate` moves a payment to PROCESSING; the provider's
confirmation (callback or status query, verified by the provider class) moves it to PAID or FAILED.
"""
import os
from typing import Optional

from app.domain.interfaces.payments import PaymentGatewayInterface


def get_provider() -> Optional[PaymentGatewayInterface]:
    name = (os.getenv("PAYOUT_PROVIDER") or "").strip().lower()
    if not name:
        return None
    raise RuntimeError(f"Unknown PAYOUT_PROVIDER '{name}'. No payout provider is implemented yet.")
