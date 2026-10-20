"""Business-rule failures. Services raise these; the API layer turns them into HTTP responses.

Each one carries what the API needs to reproduce today's response bodies exactly (core.utils.field_error,
core.utils.conflict, services.common.not_found), so moving a service off HTTPException is not a change
any client can see.
"""
from typing import Optional


class DomainError(Exception):
    """Base class. `field` names the request field at fault, so forms can show the message next to it."""

    def __init__(self, message: str, field: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.field = field


class ValidationFailed(DomainError):
    """The request breaks a business rule (422)."""


class Conflict(DomainError):
    """The request clashes with current state: a duplicate, or a record that can no longer change (409)."""


class NotFound(DomainError):
    """The record doesn't exist, or belongs to another cooperative and must look missing (404)."""

    def __init__(self, what: str):
        super().__init__(f"{what} not found")
        self.what = what


class PermissionDenied(DomainError):
    """The caller is known but may not do this (403)."""


class FeatureNotAvailable(PermissionDenied):
    """The cooperative's plan doesn't include `feature`. Raised by the feature gate once plans exist."""

    def __init__(self, feature: str, message: Optional[str] = None):
        super().__init__(message or "Your plan doesn't include this feature.")
        self.feature = feature
