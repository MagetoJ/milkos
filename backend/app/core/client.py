"""Who is on the other end of a request: address and browser."""

from fastapi import Request


def client_ip(request: Request) -> str | None:
    # Behind the Next.js proxy the browser's address arrives in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host[:64] if request.client else None


def user_agent(request: Request) -> str | None:
    return (request.headers.get("user-agent") or "")[:500] or None
