"""Verification of Supabase access tokens.

Supabase signs tokens with asymmetric keys (ES256 or RS256) published at
``/auth/v1/.well-known/jwks.json``. Projects that still use the legacy shared
secret sign with HS256; that path works only when ``SUPABASE_JWT_SECRET`` is set.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import jwt
from jwt import PyJWK

from app.core.errors import Unauthorized

from .principal import SupabaseClaims

JwksFetcher = Callable[[], Awaitable[dict[str, Any]]]

ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]


class JwksCache:
    """Caches the key set and refreshes it when an unknown ``kid`` appears (key rotation).

    Refreshes are throttled so a flood of tokens with bogus ``kid`` values cannot
    turn into a flood of requests to Supabase.
    """

    def __init__(self, fetch: JwksFetcher, ttl_seconds: float = 600, min_refresh_interval: float = 30):
        self._fetch = fetch
        self._ttl = ttl_seconds
        self._min_interval = min_refresh_interval
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()

    async def get(self, kid: str | None) -> PyJWK:
        now = time.monotonic()
        stale = now - self._fetched_at > self._ttl
        if stale or (kid not in self._keys and now - self._fetched_at > self._min_interval):
            await self._refresh()
        if kid is None and len(self._keys) == 1:
            return next(iter(self._keys.values()))
        key = self._keys.get(kid or "")
        if key is None:
            raise Unauthorized()
        return key

    async def _refresh(self) -> None:
        async with self._lock:
            # Another request may have refreshed while this one waited for the lock.
            if time.monotonic() - self._fetched_at <= self._min_interval and self._keys:
                return
            data = await self._fetch()
            keys: dict[str, PyJWK] = {}
            for jwk in data.get("keys", []):
                try:
                    keys[jwk.get("kid", "")] = PyJWK(jwk)
                except jwt.PyJWKError:
                    continue  # Unsupported key type; ignore rather than fail every request.
            self._keys = keys
            self._fetched_at = time.monotonic()


def http_jwks_fetcher(url: str, timeout: float = 5.0) -> JwksFetcher:
    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()

    return fetch


class SupabaseJwtVerifier:
    def __init__(self, *, issuer: str, audience: str, jwks: JwksCache, legacy_secret: str | None = None):
        self._issuer = issuer
        self._audience = audience
        self._jwks = jwks
        self._legacy_secret = legacy_secret

    async def verify(self, token: str) -> SupabaseClaims:
        try:
            header = jwt.get_unverified_header(token)
            alg = header.get("alg")
            options = {"require": ["exp", "sub", "iss", "aud"]}
            if alg == "HS256":
                if not self._legacy_secret:
                    raise Unauthorized()
                payload = jwt.decode(
                    token, self._legacy_secret, algorithms=["HS256"],
                    audience=self._audience, issuer=self._issuer, options=options,
                )
            elif alg in ASYMMETRIC_ALGORITHMS:
                key = await self._jwks.get(header.get("kid"))
                payload = jwt.decode(
                    token, key.key, algorithms=[alg],
                    audience=self._audience, issuer=self._issuer, options=options,
                )
            else:
                # Rejects "none" and anything else we did not choose to trust.
                raise Unauthorized()
        except jwt.PyJWTError as exc:
            raise Unauthorized() from exc
        except httpx.HTTPError as exc:
            # Cannot fetch keys: fail closed.
            raise Unauthorized() from exc

        # Service-role and anon keys are valid JWTs too; only end-user sessions may call the API.
        if not isinstance(payload.get("sub"), str) or payload.get("role") != "authenticated":
            raise Unauthorized()
        return SupabaseClaims.from_payload(payload)