"""Domain exceptions -> HTTP responses. The only place that knows which status code a business failure gets."""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.domain.exceptions import (
    Conflict, DomainError, Gone, InvalidRequest, NotFound, OperationFailed, PermissionDenied, RateLimited,
    ServiceUnavailable, Unauthenticated, ValidationFailed,
)

STATUS_CODES: dict[type[DomainError], int] = {
    InvalidRequest: 400,
    Unauthenticated: 401,
    PermissionDenied: 403,
    NotFound: 404,
    Conflict: 409,
    Gone: 410,
    ValidationFailed: 422,
    RateLimited: 429,
    OperationFailed: 500,
    ServiceUnavailable: 503,
}


def status_code_for(exc: DomainError) -> int:
    for cls in type(exc).__mro__:
        if cls in STATUS_CODES:
            return STATUS_CODES[cls]
    return 400


def detail_for(exc: DomainError):
    if exc.loc:
        return [{"loc": list(exc.loc), "msg": exc.message, "type": exc.kind}]
    return exc.message


async def _handle_domain_error(_request: Request, exc: DomainError) -> JSONResponse:
    headers = {}
    if isinstance(exc, Unauthenticated):
        headers["WWW-Authenticate"] = "Bearer"
    if exc.code:
        headers["X-Error-Code"] = exc.code
    return JSONResponse({"detail": detail_for(exc)}, status_code=status_code_for(exc), headers=headers or None)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_domain_error)
