"""The session cookie that carries the access token for browser clients."""
from fastapi import Response

from app.core.config import COOKIE_SECURE
from app.core.security import ACCESS_TOKEN_EXPIRE_MINUTES, access_token_for

COOKIE_NAME = "access_token"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME, value=token, httponly=True, secure=COOKIE_SECURE, samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, path="/",
    )


def start_session(response: Response, user) -> str:
    """A fresh access token for `user`, also set as the session cookie. Returns the token."""
    token = access_token_for(user)
    set_session_cookie(response, token)
    return token


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")
