"""Tenant/farmer isolation of the farmer portal (/api/v1/farmer): a farmer reads only their own records (spec §15)."""
import datetime
import uuid

import pytest

from models.farmer import Farmer
from schemas.auth import UserRole
from tests.test_batches import BATCHES, batch_body, confirm, world  # noqa: F401  (fixture)
from tests.test_cooperative_module import headers_for, make_user
from tests.test_finance import DAY, TODAY, price

FARMER = "/api/v1/farmer"
COOP = "/api/v1/cooperative"


def _link(session, coop, farmer, email, phone):
    user = make_user(session, coop, UserRole.FARMER, email, phone)
    session.get(Farmer, uuid.UUID(farmer["id"])).user_id = user.id
    session.commit()
    return user


@pytest.fixture
def portal(client, session, world):  # noqa: F811
    """Jane and Peter (cooperative A) and Bob (cooperative B), each with their own delivery and a farmer login."""
    assert price(client, world["admin_a"], TODAY - 30 * DAY, 50).status_code == 201
    assert price(client, world["admin_b"], TODAY - 30 * DAY, 99).status_code == 201
    when = (TODAY - 5 * DAY).isoformat()
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10), (world["peter"], 5)], captured=15, collection_date=when))
    line = {l["farmer_id"]: l["id"] for l in batch["lines"]}
    bob_batch = confirm(
        client, world["admin_b"],
        {"cooler_id": world["cooler_b"]["id"], "captured_weight_kg": 7, "weight_source": "MANUAL", "collection_date": when,
         "allocations": [{"farmer_id": world["bob_b"]["id"], "quantity_kg": 7}]},
    )
    _link(session, world["a"], world["jane"], "jane@farm.ke", "+254712345601")
    _link(session, world["a"], world["peter"], "peter@farm.ke", "+254712345602")
    _link(session, world["b"], world["bob_b"], "bob@farm.ke", "+254712345604")
    # One payment run for A's period so there are payment rows belonging to different farmers.
    gen = client.post(f"{COOP}/farmer-payments/generate", json={"period_start": (TODAY - 10 * DAY).isoformat(), "period_end": TODAY.isoformat()},
                      headers=world["admin_a"])
    assert gen.status_code in (200, 201), gen.text
    return {
        "jane": headers_for(client, "jane@farm.ke"), "peter": headers_for(client, "peter@farm.ke"), "bob": headers_for(client, "bob@farm.ke"),
        "jane_line": line[world["jane"]["id"]], "peter_line": line[world["peter"]["id"]],
        "bob_line": bob_batch["lines"][0]["id"],
    }


def test_farmer_lists_contain_only_their_own_records(client, portal):
    for who, kg, own in (("jane", 10, "jane_line"), ("peter", 5, "peter_line")):
        page = client.get(f"{FARMER}/collections", headers=portal[who]).json()
        assert [i["id"] for i in page["items"]] == [portal[own]] and page["total"] == 1
        assert page["items"][0]["quantity_kg"] == kg
        dash = client.get(f"{FARMER}/dashboard?range=30d", headers=portal[who]).json()
        assert dash["totals"]["kg"] == kg and [r["id"] for r in dash["recent"]] == [portal[own]]
    bob = client.get(f"{FARMER}/collections", headers=portal["bob"]).json()
    assert [i["id"] for i in bob["items"]] == [portal["bob_line"]]


def test_farmer_can_not_read_another_farmers_collection(client, portal):
    # Same cooperative, both directions.
    assert client.get(f"{FARMER}/collections/{portal['peter_line']}", headers=portal["jane"]).status_code == 404
    assert client.get(f"{FARMER}/collections/{portal['jane_line']}", headers=portal["peter"]).status_code == 404
    # Another cooperative, both directions.
    assert client.get(f"{FARMER}/collections/{portal['jane_line']}", headers=portal["bob"]).status_code == 404
    assert client.get(f"{FARMER}/collections/{portal['bob_line']}", headers=portal["jane"]).status_code == 404
    # Another farmer's record is indistinguishable from one that does not exist: no id probing.
    missing = client.get(f"{FARMER}/collections/{uuid.uuid4()}", headers=portal["jane"])
    foreign = client.get(f"{FARMER}/collections/{portal['peter_line']}", headers=portal["jane"])
    assert (missing.status_code, missing.json()) == (foreign.status_code, foreign.json())
    # Their own is still readable.
    assert client.get(f"{FARMER}/collections/{portal['jane_line']}", headers=portal["jane"]).status_code == 200


def test_farmer_identity_comes_from_the_token_never_from_the_request(client, portal, world):  # noqa: F811
    peter = world["peter"]["id"]
    for path in ("collections", "dashboard", "payments"):
        res = client.get(f"{FARMER}/{path}?farmer_id={peter}&cooperative_id={world['b'].id}&user_id={peter}", headers=portal["jane"])
        assert res.status_code == 200, (path, res.text)
        assert str(portal["peter_line"]) not in res.text and "Peter" not in res.text
    # Farmer endpoints are read-only.
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert client.request(method, f"{FARMER}/collections/{portal['jane_line']}", json={"quantity_kg": 999}, headers=portal["jane"]).status_code in (404, 405)


def test_farmer_payments_and_prices_are_their_own_cooperatives(client, portal):
    jane, peter = (client.get(f"{FARMER}/payments", headers=portal[w]).json() for w in ("jane", "peter"))
    assert jane and peter and {p["id"] for p in jane}.isdisjoint({p["id"] for p in peter})
    assert [p["total_kg"] for p in jane] == [10] and [p["total_kg"] for p in peter] == [5]
    assert client.get(f"{FARMER}/payments", headers=portal["bob"]).json() == []
    assert [p["price_per_kg"] for p in client.get(f"{FARMER}/prices", headers=portal["jane"]).json()] == [50]
    assert [p["price_per_kg"] for p in client.get(f"{FARMER}/prices", headers=portal["bob"]).json()] == [99]


def test_unauthenticated_or_unlinked_or_wrong_role_is_refused(client, session, world, portal):  # noqa: F811
    for path in ("dashboard", "collections", "payments", "prices", f"collections/{portal['jane_line']}"):
        assert client.get(f"{FARMER}/{path}").status_code in (401, 403)
        for who in ("col_a", "admin_a", "manager_a", "admin_b"):
            assert client.get(f"{FARMER}/{path}", headers=world[who]).status_code == 403, (path, who)
    # A farmer login that is not linked to any farmer record sees nothing.
    make_user(session, world["a"], UserRole.FARMER, "orphan@farm.ke", "+254712345699")
    orphan = headers_for(client, "orphan@farm.ke")
    for path in ("dashboard", "collections", "payments", f"collections/{portal['jane_line']}"):
        assert client.get(f"{FARMER}/{path}", headers=orphan).status_code == 403, path


def test_farmer_records_are_never_visible_in_another_farmers_dashboard_totals(client, portal):
    jane = client.get(f"{FARMER}/dashboard?range=30d", headers=portal["jane"]).json()
    assert jane["farmer"]["name"].startswith("Jane") and jane["totals"]["deliveries"] == 1
    assert sum(d["kg"] for d in jane["daily"]) == 10
    assert datetime.date.fromisoformat(jane["period"]["to"]) == TODAY


def test_this_month_is_calendar_month_to_date_whatever_the_range(client, session, world):  # noqa: F811
    _link(session, world["a"], world["jane"], "jane@farm.ke", "+254712345601")
    jane = headers_for(client, "jane@farm.ke")
    confirm(client, world["col_a"], batch_body(world, [(world["jane"], 8), (world["peter"], 3)], captured=11, collection_date=TODAY.isoformat()))
    # 45 days back is always in an earlier month, so it must never count towards "this month".
    confirm(client, world["col_a"], batch_body(world, [(world["jane"], 20)], captured=20, collection_date=(TODAY - 45 * DAY).isoformat()))
    for rng in ("today", "7d", "30d", "3m"):
        dash = client.get(f"{FARMER}/dashboard?range={rng}", headers=jane).json()
        assert dash["this_month"] == {"kg": 8, "deliveries": 1, "month": TODAY.strftime("%Y-%m")}, rng
    assert client.get(f"{FARMER}/dashboard?range=3m", headers=jane).json()["totals"]["kg"] == 28
