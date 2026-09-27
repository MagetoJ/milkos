import re
from dataclasses import dataclass
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"
# Client-supplied request IDs are echoed into logs and audit rows, so only
# accept short, log-safe values.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        supplied = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = supplied if _SAFE_REQUEST_ID.match(supplied) else str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


@dataclass(frozen=True)
class RequestContext:
    ip_address: str
    user_agent: str | None
    request_id: str | None


def get_request_context(request: Request) -> RequestContext:
    user_agent = request.headers.get("user-agent")
    return RequestContext(
        ip_address=request.client.host if request.client else "unknown",
        user_agent=user_agent[:512] if user_agent else None,
        request_id=getattr(request.state, "request_id", None),
    )
