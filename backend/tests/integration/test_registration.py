import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.models.cooperative import Cooperative
from app.models.registration import RegistrationVerification
from tests.integration.conftest import submit_application, verify_phone

START = "/api/v1/cooperatives/registration/verify/start"
CONFIRM = "/api/v1/cooperatives/registration/verify/confirm"
APPLICATIONS = "/api/v1/cooperatives/applications"


async def start(client, headers, phone="+254712345678"):
    return await client.post(
        START, json={"channel": "PHONE", "destination": phone}, headers=headers
    )


async def test_verification_requires_authentication(client):
    response = await client.post(START, json={"channel": "PHONE", "destination": "+254712345678"})
    assert response.status_code == 401


async def test_otp_is_stored_as_keyed_hash_only(client, new_user, session_factory):
    response = await start(client, new_user())
    code = response.json()["code"]

    async with session_factory() as db:
        stored = await db.scalar(select(RegistrationVerification.code_hash))
    assert code not in stored
    assert len(stored) == 64


async def test_code_is_never_returned_unless_dev_mode(client, new_user, settings, session_factory,
                                                     monkeypatch):
    monkeypatch.setattr(settings, "expose_dev_otp", False)

    response = await start(client, new_user())

    # No delivery provider is configured: fail loudly, persist nothing.
    assert response.status_code == 503
    assert "code" not in response.text
    async with session_factory() as db:
        assert await db.scalar(
            select(func.count()).select_from(RegistrationVerification)
        ) == 0


async def test_another_user_cannot_confirm_my_verification(client, new_user):
    alice, mallory = new_user(), new_user()
    body = (await start(client, alice)).json()

    response = await client.post(
        CONFIRM,
        json={"verification_id": body["verification_id"], "code": body["code"]},
        headers=mallory,
    )
    assert response.status_code == 404


async def test_another_user_cannot_apply_with_my_verified_phone(client, new_user):
    alice, mallory = new_user(), new_user()
    verification_id = await verify_phone(client, alice)

    response = await submit_application(client, mallory, verification_id=verification_id)
    assert response.status_code == 403


async def test_verification_cannot_be_reused(client, new_user, admin):
    applicant = new_user()
    verification_id = await verify_phone(client, applicant)
    first = await submit_application(client, applicant, verification_id=verification_id)
    assert first.status_code == 201
    # Close the first application so only the verification reuse is tested.
    await client.post(
        f"{APPLICATIONS}/{first.json()['application_id']}/review",
        json={"status": "REJECTED"},
        headers=admin,
    )

    second = await submit_application(
        client, applicant, name="Another Coop", verification_id=verification_id
    )
    assert second.status_code == 403


async def test_verified_phone_must_match_application_phone(client, new_user):
    applicant = new_user()
    verification_id = await verify_phone(client, applicant, "+254712345678")

    response = await submit_application(
        client, applicant, phone="+254700000000", verification_id=verification_id
    )
    assert response.status_code == 403


async def test_stale_verification_is_rejected(client, new_user, session_factory):
    applicant = new_user()
    verification_id = await verify_phone(client, applicant)
    async with session_factory() as db:
        await db.execute(
            update(RegistrationVerification).values(
                verified_at=datetime.now(UTC) - timedelta(hours=1)
            )
        )
        await db.commit()

    response = await submit_application(client, applicant, verification_id=verification_id)
    assert response.status_code == 403


async def test_expired_code_cannot_be_confirmed(client, new_user, session_factory):
    applicant = new_user()
    body = (await start(client, applicant)).json()
    async with session_factory() as db:
        await db.execute(
            update(RegistrationVerification).values(
                expires_at=datetime.now(UTC) - timedelta(seconds=1)
            )
        )
        await db.commit()

    response = await client.post(
        CONFIRM, json={"verification_id": body["verification_id"], "code": body["code"]},
        headers=applicant,
    )
    assert response.status_code == 400


async def test_verification_locks_after_too_many_wrong_codes(client, new_user):
    applicant = new_user()
    body = (await start(client, applicant)).json()
    wrong = "000000" if body["code"] != "000000" else "111111"

    for _ in range(5):
        response = await client.post(
            CONFIRM, json={"verification_id": body["verification_id"], "code": wrong},
            headers=applicant,
        )
        assert response.status_code == 400

    # Even the right code no longer works.
    response = await client.post(
        CONFIRM, json={"verification_id": body["verification_id"], "code": body["code"]},
        headers=applicant,
    )
    assert response.status_code == 400


async def test_new_code_supersedes_previous_one(client, new_user):
    applicant = new_user()
    old = (await start(client, applicant)).json()
    await start(client, applicant)

    response = await client.post(
        CONFIRM, json={"verification_id": old["verification_id"], "code": old["code"]},
        headers=applicant,
    )
    assert response.status_code == 400


async def test_verification_start_is_rate_limited_per_user(client, new_user):
    applicant = new_user()
    for i in range(3):
        assert (await start(client, applicant, f"+25471234567{i}")).status_code == 200
    assert (await start(client, applicant, "+254712345679")).status_code == 429


async def test_verification_start_is_rate_limited_per_destination(client, new_user):
    for _ in range(3):
        assert (await start(client, new_user())).status_code == 200
    assert (await start(client, new_user())).status_code == 429


async def test_invalid_phone_is_rejected(client, new_user):
    assert (await start(client, new_user(), "not-a-phone")).status_code == 422


async def test_client_cannot_supply_server_owned_fields(client, new_user):
    applicant = new_user()
    response = await submit_application(
        client, applicant, cooperative_id="00000000-0000-0000-0000-000000000001"
    )
    assert response.status_code == 422


async def test_duplicate_cooperative_name_is_rejected(client, new_user):
    first = await submit_application(client, new_user(), name="Mogor Smart Farms")
    assert first.status_code == 201

    second = await submit_application(
        client, new_user(), name="  mogor   SMART farms ", phone="+254700000001"
    )
    assert second.status_code == 409


async def test_concurrent_duplicate_registrations_create_one_tenant(
    client, new_user, session_factory
):
    applicants = [(new_user(), f"+25471000000{i}") for i in range(3)]
    verifications = [await verify_phone(client, headers, phone) for headers, phone in applicants]

    responses = await asyncio.gather(
        *(
            submit_application(
                client, headers, name="Race Coop", phone=phone, verification_id=verification
            )
            for (headers, phone), verification in zip(applicants, verifications)
        )
    )

    assert sorted(response.status_code for response in responses) == [201, 409, 409]
    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Cooperative)) == 1


async def test_one_open_application_per_applicant(client, new_user):
    applicant = new_user()
    assert (await submit_application(client, applicant, name="Coop One")).status_code == 201

    response = await submit_application(client, applicant, name="Coop Two")
    assert response.status_code == 409


async def test_application_status_is_private_to_applicant(client, new_user):
    applicant, stranger = new_user(), new_user()
    reference = (await submit_application(client, applicant)).json()["reference"]

    own = await client.get(f"{APPLICATIONS}/by-reference/{reference}", headers=applicant)
    other = await client.get(f"{APPLICATIONS}/by-reference/{reference}", headers=stranger)
    public = await client.get(f"{APPLICATIONS}/by-reference/{reference}")

    assert own.status_code == 200
    assert own.json()["status"] == "PENDING"
    assert other.status_code == 404
    assert public.status_code == 401


async def test_audit_log_is_append_only(client, new_user, session_factory):
    await submit_application(client, new_user())

    async with session_factory() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("UPDATE audit_events SET result = 'TAMPERED'"))
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("DELETE FROM security_events"))
