"""Contracts the services depend on. Implementations live in app.infrastructure.

These are Protocols (structural interfaces): an implementation satisfies one by having the right methods,
without inheriting from it. That keeps test fakes like tests.conftest.RecordingSms one small class.
"""
from app.domain.interfaces.payments import PaymentGatewayInterface, PayoutResult
from app.domain.interfaces.repositories import Repository, TenantScopedRepository, UnitOfWork
from app.domain.interfaces.sms import GatewayConfigurationError, SMSGatewayInterface, SmsResult
from app.domain.interfaces.tasks import TaskDispatcher

__all__ = [
    "GatewayConfigurationError",
    "PaymentGatewayInterface",
    "PayoutResult",
    "Repository",
    "SMSGatewayInterface",
    "SmsResult",
    "TaskDispatcher",
    "TenantScopedRepository",
    "UnitOfWork",
]
