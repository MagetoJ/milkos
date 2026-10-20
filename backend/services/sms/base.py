"""The SMS provider contract, now defined in app.domain.interfaces.sms. Kept so existing imports work."""
from app.domain.interfaces.sms import GatewayConfigurationError, SMSGatewayInterface, SmsResult  # noqa: F401

SmsProvider = SMSGatewayInterface
SmsProviderError = GatewayConfigurationError
