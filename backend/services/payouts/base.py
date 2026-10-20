"""The payout provider contract, now defined in app.domain.interfaces.payments. Kept so existing imports work."""
from app.domain.interfaces.payments import PaymentGatewayInterface, PayoutResult  # noqa: F401

PayoutProvider = PaymentGatewayInterface
