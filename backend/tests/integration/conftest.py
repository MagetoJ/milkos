import time
from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from tests.conftest import TEST_DATABASE_URL

if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL is not set", allow_module_level=True)

from alembic.config import Config

from alembic import command
from app.core.config import get_settings
from app.db.session import get_db
from app.main import app
from app.security.keycloak import keycloak_verifier

ISSUER = "http://keycloak.test/realms/milk"
KID = "test-key"
_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

TABLES = (
    "security_events",
    "audit_events",
    "memberships",
    "registration_verifications",
    "cooperative_applications",
    "cooperatives",
    "users",
)


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    command.upgrade(Config("alembic.ini"), "head")


@pytest.fixture(autouse=True)
def trusted_jwks() -> None:
    public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(_PRIVATE_KEY.public_key(), as_dict=True)
    public_jwk.update({"kid": KID, "alg": "RS256", "use": "sig"})
    keycloak_verifier._jwks = {"keys": [public_jwk]}
    keycloak_verifier._expires_at = float("inf")


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    # NullPool: no connections are shared across pytest-asyncio event loops.
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as connection:
        # Fail fast rather than hang if a leaked transaction holds a lock.
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        await connection.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    yield factory
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
async def client(session_factory) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def make_token(sub: str, *, roles: list[str] | None = None, **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": "milk-api",
        "azp": "milk-web",
        "typ": "Bearer",
        "sub": sub,
        "iat": now,
        "exp": now + 300,
        "name": f"User {sub[:8]}",
        "email": f"{sub[:8]}@example.com",
        "email_verified": True,
        "realm_access": {"roles": roles or []},
    }
    claims.update(overrides)
    return jwt.encode(claims, _PRIVATE_KEY, algorithm="RS256", headers={"kid": KID})


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def new_user() -> Callable[..., dict[str, str]]:
    """Return auth headers for a fresh Keycloak identity."""

    def factory(*, roles: list[str] | None = None) -> dict[str, str]:
        return auth(make_token(str(uuid4()), roles=roles))

    return factory


@pytest.fixture
def admin(new_user) -> dict[str, str]:
    return new_user(roles=["PLATFORM_SUPER_ADMIN"])


@pytest.fixture
def settings():
    return get_settings()


async def verify_phone(
    client: httpx.AsyncClient, headers: dict[str, str], phone: str = "+254712345678"
) -> str:
    start = await client.post(
        "/api/v1/cooperatives/registration/verify/start",
        json={"channel": "PHONE", "destination": phone},
        headers=headers,
    )
    assert start.status_code == 200, start.text
    body = start.json()
    confirm = await client.post(
        "/api/v1/cooperatives/registration/verify/confirm",
        json={"verification_id": body["verification_id"], "code": body["code"]},
        headers=headers,
    )
    assert confirm.status_code == 200, confirm.text
    return body["verification_id"]


async def submit_application(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    name: str = "Mogor Smart Farms",
    phone: str = "+254712345678",
    verification_id: str | None = None,
    **extra: Any,
) -> httpx.Response:
    if verification_id is None:
        verification_id = await verify_phone(client, headers, phone)
    return await client.post(
        "/api/v1/cooperatives/applications",
        json={"name": name, "phone": phone, "phone_verification_id": verification_id, **extra},
        headers=headers,
    )


async def register_approved_cooperative(
    client: httpx.AsyncClient,
    applicant: dict[str, str],
    admin: dict[str, str],
    *,
    name: str,
    phone: str,
) -> str:
    submitted = await submit_application(client, applicant, name=name, phone=phone)
    assert submitted.status_code == 201, submitted.text
    reviewed = await client.post(
        f"/api/v1/cooperatives/applications/{submitted.json()['application_id']}/review",
        json={"status": "APPROVED"},
        headers=admin,
    )
    assert reviewed.status_code == 200, reviewed.text
    return reviewed.json()["cooperative_id"]
