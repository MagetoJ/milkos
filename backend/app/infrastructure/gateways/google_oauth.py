"""Google sign-in (OAuth 2.0 authorisation-code flow): the consent URL and the code -> verified email exchange."""
import os
from typing import Optional

import httpx

from app.core.config import APP_URL

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
# Google is sent back through the web app's public URL (Next proxies /api/v1 to this backend), so the
# session cookie and the final redirect both land on the app's own origin.
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", f"{APP_URL}/api/v1/auth/google/callback")

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class GoogleAuthError(RuntimeError):
    """Google refused the code or the profile request; the message is safe to show."""


def consent_url() -> str:
    return (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"response_type=code&client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}&scope=openid%20email%20profile"
    )


async def email_for_code(code: str, client: Optional[httpx.AsyncClient] = None) -> str:
    """Exchange the authorisation code and return the account's email address (lower case)."""
    data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    async with (client or httpx.AsyncClient()) as http:
        res = await http.post(TOKEN_URL, data=data)
        if res.status_code != 200:
            raise GoogleAuthError("Failed to authenticate with Google")
        token = res.json()["access_token"]
        profile = await http.get(USERINFO_URL, headers={"Authorization": f"Bearer {token}"})
        if profile.status_code != 200:
            raise GoogleAuthError("Failed to fetch Google profile")
    return (profile.json().get("email") or "").lower()
