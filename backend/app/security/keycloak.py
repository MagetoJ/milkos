import time
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status

from app.core.config import get_settings

# Minimum spacing between JWKS refreshes forced by an unknown `kid`, so
# tokens with random key IDs cannot turn every request into a Keycloak call.
FORCED_REFRESH_INTERVAL_SECONDS = 30.0


class KeycloakTokenVerifier:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._jwks: dict[str, Any] | None = None
        self._expires_at = 0.0
        self._last_forced_refresh = float("-inf")

    async def _get_jwks(self) -> dict[str, Any]:
        now = time.monotonic()

        if self._jwks is not None and now < self._expires_at:
            return self._jwks

        url = (
            f"{self.settings.keycloak_issuer.rstrip('/')}"
            "/protocol/openid-connect/certs"
        )

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                jwks = response.json()

        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service unavailable",
            ) from exc

        if not isinstance(jwks, dict) or not isinstance(
            jwks.get("keys"), list
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invalid authentication service response",
            )

        self._jwks = jwks
        self._expires_at = (
            now + self.settings.jwks_cache_seconds
        )

        return jwks

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)

            kid = header.get("kid")
            algorithm = header.get("alg")

            if not kid:
                raise ValueError("Missing token key ID")

            if algorithm != "RS256":
                raise ValueError("Unsupported token algorithm")

            jwks = await self._get_jwks()

            key_data = next(
                (
                    key
                    for key in jwks["keys"]
                    if key.get("kid") == kid
                ),
                None,
            )

            # Key rotation protection:
            # refresh JWKS once if the current key is unknown.
            now = time.monotonic()
            if (
                key_data is None
                and now - self._last_forced_refresh >= FORCED_REFRESH_INTERVAL_SECONDS
            ):
                self._last_forced_refresh = now
                self._jwks = None
                self._expires_at = 0

                jwks = await self._get_jwks()

                key_data = next(
                    (
                        key
                        for key in jwks["keys"]
                        if key.get("kid") == kid
                    ),
                    None,
                )

            if key_data is None:
                raise ValueError("Signing key not found")

            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(
                key_data
            )

            claims = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=self.settings.keycloak_audience,
                issuer=self.settings.keycloak_issuer,
                options={
                    "require": [
                        "exp",
                        "iat",
                        "sub",
                    ],
                },
            )

            # Keycloak marks access tokens with typ=Bearer; ID and refresh
            # tokens must never be accepted as API credentials.
            if claims.get("typ") != "Bearer":
                raise ValueError("Not an access token")

            # Only tokens issued to the Milkos web client are accepted, even
            # if another client in the realm can mint tokens for this audience.
            if claims.get("azp") != self.settings.keycloak_client_id:
                raise ValueError("Unexpected authorized party")

            if not isinstance(claims["sub"], str) or not claims["sub"]:
                raise ValueError("Invalid subject")

            return claims

        except (
            jwt.PyJWTError,
            ValueError,
            KeyError,
            TypeError,
        ) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={
                    "WWW-Authenticate": "Bearer"
                },
            ) from exc


keycloak_verifier = KeycloakTokenVerifier()
