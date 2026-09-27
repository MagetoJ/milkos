import asyncio
from uuid import uuid4

from sqlalchemy import func, select

from app.models.user import User
from tests.integration.conftest import auth, make_token


async def test_missing_token_is_rejected(client):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_id_token_is_not_accepted_as_access_token(client):
    response = await client.post(
        "/api/v1/auth/register", headers=auth(make_token(str(uuid4()), typ="ID"))
    )
    assert response.status_code == 401


async def test_token_for_another_client_is_rejected(client):
    response = await client.post(
        "/api/v1/auth/register", headers=auth(make_token(str(uuid4()), azp="other-client"))
    )
    assert response.status_code == 401


async def test_token_for_another_audience_is_rejected(client):
    response = await client.post(
        "/api/v1/auth/register", headers=auth(make_token(str(uuid4()), aud="another-api"))
    )
    assert response.status_code == 401


async def test_expired_token_is_rejected(client):
    response = await client.post(
        "/api/v1/auth/register", headers=auth(make_token(str(uuid4()), exp=1))
    )
    assert response.status_code == 401


async def test_me_requires_registration(client, new_user):
    response = await client.get("/api/v1/auth/me", headers=new_user())
    assert response.status_code == 403


async def test_register_is_idempotent_and_grants_no_tenant_access(client, new_user):
    headers = new_user()

    first = await client.post("/api/v1/auth/register", headers=headers)
    second = await client.post("/api/v1/auth/register", headers=headers)
    me = await client.get("/api/v1/auth/me", headers=headers)

    assert first.status_code == second.status_code == me.status_code == 200
    assert first.json()["id"] == second.json()["id"] == me.json()["id"]
    assert me.json()["memberships"] == []
    assert me.json()["platform_roles"] == []


async def test_concurrent_first_requests_provision_one_user(client, session_factory):
    sub = str(uuid4())
    headers = auth(make_token(sub))

    responses = await asyncio.gather(
        *(client.post("/api/v1/auth/register", headers=headers) for _ in range(5))
    )

    assert all(response.status_code == 200 for response in responses)
    async with session_factory() as db:
        count = await db.scalar(
            select(func.count()).select_from(User).where(User.keycloak_id == sub)
        )
    assert count == 1


async def test_unverified_email_is_not_trusted(client):
    headers = auth(make_token(str(uuid4()), email="victim@example.com", email_verified=False))
    response = await client.post("/api/v1/auth/register", headers=headers)
    assert response.json()["email"] is None


async def test_platform_role_is_reported(client, admin):
    response = await client.post("/api/v1/auth/register", headers=admin)
    assert response.json()["platform_roles"] == ["PLATFORM_SUPER_ADMIN"]
