"""Google OAuth 2.0 helpers for website and native Android authentication."""

import base64
import hashlib
import os
import secrets
from urllib.parse import urlencode

import httpx

from app.core.config import APP_URL

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Existing website callback. Keep this URI registered in Google Cloud Console.
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI",
    f"{APP_URL}/api/v1/auth/google/callback",
)

# Separate backend callback for Android OAuth.
GOOGLE_NATIVE_REDIRECT_URI = os.getenv(
    "GOOGLE_NATIVE_REDIRECT_URI",
    f"{APP_URL}/api/v1/auth/google/native/callback",
)

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"


class GoogleAuthError(RuntimeError):
    """Google refused the authorization or profile request."""


def generate_state() -> str:
    """Generate an unpredictable OAuth state value."""
    return secrets.token_urlsafe(32)


def generate_pkce_pair() -> tuple[str, str]:
    """Return a PKCE verifier and its S256 challenge."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def consent_url(state: str | None = None) -> str:
    """Website OAuth consent URL (supports optional state for sign-up vs sign-in)."""
    params = {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "scope": "openid email profile",
    }
    if state:
        params["state"] = state
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def native_consent_url(state: str, code_challenge: str) -> str:
    """Build Google's authorization URL for the Android native flow."""
    if not GOOGLE_CLIENT_ID:
        raise GoogleAuthError("Google sign-in is not configured")

    params = {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_NATIVE_REDIRECT_URI,
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def _profile_for_code(
    code: str,
    redirect_uri: str,
    code_verifier: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, str]:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise GoogleAuthError("Google sign-in is not configured")

    data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    if code_verifier:
        data["code_verifier"] = code_verifier

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=15.0)

    try:
        token_response = await http.post(TOKEN_URL, data=data)

        if token_response.status_code != 200:
            raise GoogleAuthError("Failed to authenticate with Google")

        access_token = token_response.json().get("access_token")
        if not access_token:
            raise GoogleAuthError("Google did not return an access token")

        profile_response = await http.get(
            USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if profile_response.status_code != 200:
            raise GoogleAuthError("Failed to fetch Google profile")

        profile = profile_response.json()
        email = (profile.get("email") or "").strip().lower()

        verified = profile.get("email_verified", profile.get("verified_email", False))
        if not isinstance(verified, bool):
            verified = str(verified).strip().lower() == "true"

        if not email or not verified:
            raise GoogleAuthError("Google account email is missing or not verified")

        full_name = (profile.get("name") or email.split("@")[0]).strip()
        sub = str(profile.get("id") or profile.get("sub") or "")
        return {"email": email, "name": full_name, "sub": sub}

    except GoogleAuthError:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise GoogleAuthError("Unable to complete Google authentication") from exc
    finally:
        if owns_client:
            await http.aclose()


async def profile_for_code(
    code: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, str]:
    """Exchange website authorization code for verified Google profile."""
    return await _profile_for_code(
        code=code,
        redirect_uri=GOOGLE_REDIRECT_URI,
        client=client,
    )


async def profile_for_native_code(
    code: str,
    code_verifier: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, str]:
    """Exchange native PKCE authorization code for verified Google profile."""
    return await _profile_for_code(
        code=code,
        redirect_uri=GOOGLE_NATIVE_REDIRECT_URI,
        code_verifier=code_verifier,
        client=client,
    )


async def email_for_code(
    code: str,
    client: httpx.AsyncClient | None = None,
) -> str:
    """Existing website authorization-code exchange."""
    profile = await profile_for_code(code=code, client=client)
    return profile["email"]


async def email_for_native_code(
    code: str,
    code_verifier: str,
    client: httpx.AsyncClient | None = None,
) -> str:
    """Exchange a native authorization code using its PKCE verifier."""
    profile = await profile_for_native_code(
        code=code,
        code_verifier=code_verifier,
        client=client,
    )
    return profile["email"]
