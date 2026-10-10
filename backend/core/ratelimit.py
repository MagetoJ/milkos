"""A small in-process sliding-window limiter for unauthenticated endpoints (sign-in, activation, password reset).

Per-account limits (OTP attempts, resend cooldowns, sign-in lockout) are stored in the database and hold across
workers; this limiter only adds a per-client-address ceiling against bulk guessing. With several API workers each
keeps its own window, so the effective ceiling is (limit x workers) - put a shared limiter (reverse proxy or Redis)
in front for strict guarantees.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
TOO_MANY = "Too many attempts. Wait a few minutes and try again."


def _client(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def hit(request: Request, bucket: str, limit: int, window_seconds: int) -> None:
    """Count one request from this client in `bucket`; 429 once `limit` is exceeded within the window."""
    key = f"{bucket}:{_client(request)}"
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY)
        q.append(now)


def reset() -> None:
    """Forget every window (tests)."""
    with _lock:
        _hits.clear()
