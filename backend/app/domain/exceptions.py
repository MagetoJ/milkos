"""Business-rule failures. Services raise these; app/api/errors.py turns them into HTTP responses.

Services never import FastAPI. Each exception carries what the API needs to reproduce the response bodies
clients already rely on:

    raise Conflict("This price was already cancelled.")
        -> 409 {"detail": "This price was already cancelled."}
    raise ValidationFailed("Say why this milk was rejected.", field="rejection_reason")
        -> 422 {"detail": [{"loc": ["body", "rejection_reason"], "msg": "...", "type": "invalid"}]}

A message tied to a field (or an explicit `loc`) is sent in FastAPI's validation-error shape so forms show it
next to that field; anything else is a plain message. `code`, when given, is a machine-readable reason the client
can branch on (sent as the X-Error-Code header, so `detail` stays a message people can read).
"""
from typing import Optional, Sequence


class DomainError(Exception):
    default_kind = "invalid"

    def __init__(self, message: str, field: Optional[str] = None, *, loc: Optional[Sequence[str]] = None,
                 kind: Optional[str] = None, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.loc: Optional[tuple[str, ...]] = tuple(loc) if loc is not None else (("body", field) if field else None)
        self.kind = kind or self.default_kind

    @property
    def fields(self) -> dict[str, str]:
        """{field: message} for a field-level error (the last part of `loc`), else {}."""
        parts = [p for p in (self.loc or ()) if p != "body"]
        return {parts[-1]: self.message} if parts else {}


class InvalidRequest(DomainError):
    """The request can't be acted on as sent: a wrong code, a missing step (400)."""


class Unauthenticated(DomainError):
    """The caller's credentials are missing, wrong or no longer valid (401)."""


class PermissionDenied(DomainError):
    """The caller is known but may not do this (403)."""


class NotFound(DomainError):
    """The record doesn't exist, or belongs to another cooperative and must look missing (404)."""

    def __init__(self, what: str, message: Optional[str] = None):
        super().__init__(message or f"{what} not found")
        self.what = what


class Conflict(DomainError):
    """The request clashes with current state: a duplicate, or a record that can no longer change (409)."""
    default_kind = "conflict"


class Gone(DomainError):
    """A one-time link or code that was valid once and is not any more (410)."""


class ValidationFailed(DomainError):
    """The request breaks a business rule (422)."""


class RateLimited(DomainError):
    """Too many attempts; try again later (429)."""


class ServiceUnavailable(DomainError):
    """The operation is switched off for now (503)."""


class OperationFailed(DomainError):
    """The operation could not be completed for a reason that isn't the caller's (500)."""
