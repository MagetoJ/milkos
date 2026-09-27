from uuid import uuid4

from sqlalchemy import select, update

from app.models.cooperative import Cooperative, CooperativeStatus
from app.models.membership import Membership
from tests.integration.conftest import register_approved_cooperative, submit_application

APPLICATIONS = "/api/v1/cooperatives/applications"


async def test_applicant_has_no_access_until_approved(client, new_user, admin, session_factory):
    applicant = new_user()
    submitted = await submit_application(client, applicant)
    assert submitted.status_code == 201

    async with session_factory() as db:
        cooperative_id = await db.scalar(select(Cooperative.id))
        assert await db.scalar(select(Membership.id)) is None

    pending = await client.get(f"/api/v1/cooperatives/{cooperative_id}", headers=applicant)
    assert pending.status_code == 404
    assert (await client.get("/api/v1/auth/me", headers=applicant)).json()["memberships"] == []

    reviewed = await client.post(
        f"{APPLICATIONS}/{submitted.json()['application_id']}/review",
        json={"status": "APPROVED"},
        headers=admin,
    )
    assert reviewed.status_code == 200

    approved = await client.get(f"/api/v1/cooperatives/{cooperative_id}", headers=applicant)
    assert approved.status_code == 200
    assert approved.json()["roles"] == ["COOPERATIVE_MANAGER"]
    me = (await client.get("/api/v1/auth/me", headers=applicant)).json()
    assert [m["cooperative_id"] for m in me["memberships"]] == [str(cooperative_id)]


async def test_manager_cannot_access_another_cooperative(client, new_user, admin):
    alice, bob = new_user(), new_user()
    coop_a = await register_approved_cooperative(
        client, alice, admin, name="Coop A", phone="+254711111111"
    )
    coop_b = await register_approved_cooperative(
        client, bob, admin, name="Coop B", phone="+254722222222"
    )

    assert (await client.get(f"/api/v1/cooperatives/{coop_a}", headers=alice)).status_code == 200
    assert (await client.get(f"/api/v1/cooperatives/{coop_b}", headers=alice)).status_code == 404
    assert (await client.get(f"/api/v1/cooperatives/{coop_a}", headers=bob)).status_code == 404
    # Unknown and foreign cooperatives are indistinguishable.
    assert (
        await client.get(f"/api/v1/cooperatives/{uuid4()}", headers=alice)
    ).status_code == 404


async def test_rejected_application_grants_no_membership(client, new_user, admin, session_factory):
    applicant = new_user()
    submitted = await submit_application(client, applicant)

    await client.post(
        f"{APPLICATIONS}/{submitted.json()['application_id']}/review",
        json={"status": "REJECTED", "notes": "Incomplete registration"},
        headers=admin,
    )

    async with session_factory() as db:
        assert await db.scalar(select(Membership.id)) is None
    mine = (await client.get(f"{APPLICATIONS}/mine", headers=applicant)).json()
    assert mine[0]["status"] == "REJECTED"
    assert mine[0]["notes"] == "Incomplete registration"


async def test_suspended_cooperative_loses_access(client, new_user, admin, session_factory):
    manager = new_user()
    cooperative_id = await register_approved_cooperative(
        client, manager, admin, name="Coop A", phone="+254711111111"
    )
    async with session_factory() as db:
        await db.execute(update(Cooperative).values(status=CooperativeStatus.SUSPENDED))
        await db.commit()

    response = await client.get(f"/api/v1/cooperatives/{cooperative_id}", headers=manager)
    assert response.status_code == 404
    assert (await client.get("/api/v1/auth/me", headers=manager)).json()["memberships"] == []


async def test_admin_endpoints_require_platform_role(client, new_user):
    applicant, other = new_user(), new_user()
    application_id = (await submit_application(client, applicant)).json()["application_id"]

    listing = await client.get(APPLICATIONS, headers=other)
    review = await client.post(
        f"{APPLICATIONS}/{application_id}/review", json={"status": "APPROVED"}, headers=applicant
    )

    assert listing.status_code == 403
    assert review.status_code == 403


async def test_admin_cannot_approve_own_application(client, admin):
    submitted = await submit_application(client, admin)

    response = await client.post(
        f"{APPLICATIONS}/{submitted.json()['application_id']}/review",
        json={"status": "APPROVED"},
        headers=admin,
    )
    assert response.status_code == 403


async def test_closed_application_cannot_be_reviewed_again(client, new_user, admin):
    applicant = new_user()
    application_id = (await submit_application(client, applicant)).json()["application_id"]
    url = f"{APPLICATIONS}/{application_id}/review"

    assert (await client.post(url, json={"status": "REJECTED"}, headers=admin)).status_code == 200
    assert (await client.post(url, json={"status": "APPROVED"}, headers=admin)).status_code == 409


async def test_admin_can_list_and_filter_applications(client, new_user, admin):
    await submit_application(client, new_user())

    pending = await client.get(APPLICATIONS, params={"status": "PENDING"}, headers=admin)
    approved = await client.get(APPLICATIONS, params={"status": "APPROVED"}, headers=admin)

    assert pending.status_code == 200
    assert len(pending.json()) == 1
    assert approved.json() == []
