"""Collector phone masking, payment 'request information', the farmer's own view and cross-cooperative isolation."""
import uuid

from models.admin import AuditLog
from models.user import User
from schemas.auth import UserRole
from tests.test_batches import BATCHES, batch_body, confirm, world  # noqa: F401  (fixture)
from tests.test_cooperative_module import PASSWORD, headers_for, make_user
from tests.test_sync import pull_all, register

COOP = "/api/v1/cooperative"
SA = "/api/v1/superadmin"
FARMER = "/api/v1/farmer"


# ---------------- collectors never get full farmer phone numbers ----------------

def test_collector_farmer_search_masks_phone_numbers(client, world):
    options = client.get("/api/v1/collections/options?search=jane", headers=world["col_a"]).json()
    jane = options["farmers"][0]
    assert "phone" not in jane and jane["phone_masked"] == "0712••••01"
    # Searching by the phone number still works (the server compares; the device only sees the mask).
    by_phone = client.get("/api/v1/collections/options?search=0712345601", headers=world["col_a"]).json()
    assert [f["id"] for f in by_phone["farmers"]] == [jane["id"]]
    by_number = client.get(f"/api/v1/collections/options?search={jane['farmer_number']}", headers=world["col_a"]).json()
    assert [f["id"] for f in by_number["farmers"]] == [jane["id"]]
    # Staff still see the full number.
    staff = client.get("/api/v1/collections/options?search=jane", headers=world["admin_a"]).json()
    assert staff["farmers"][0]["phone"] == "+254712345601"


def test_offline_farmer_records_on_collector_devices_are_masked(client, world):
    device, _ = register(client, world["col_a"])
    changes, _ = pull_all(client, world["col_a"], device)
    farmers = [c["data"] for c in changes if c["entity_type"] == "farmer" and c.get("data")]
    assert farmers and all("phone" not in f and f["phone_masked"].startswith("0712") for f in farmers)
    assert all("national_id" not in f and "payment_account" not in f for f in farmers)


# ---------------- exact allocation is enforced by the server ----------------

def test_confirmation_needs_exactly_the_captured_weight(client, world):
    under = client.post(BATCHES, json=batch_body(world, [(world["jane"], 20)], captured=20.01), headers=world["col_a"])
    assert under.status_code == 422 and "0.01 KG" in str(under.json()["detail"])
    over = client.post(BATCHES, json=batch_body(world, [(world["jane"], 20.02)], captured=20.01), headers=world["col_a"])
    assert over.status_code == 422 and "more than the captured" in str(over.json()["detail"])
    # Hundredths that don't add up exactly in binary floating point still count as exact.
    ok = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 0.1), (world["peter"], 0.2)], captured=0.3))
    assert ok["remaining_weight_kg"] == 0


# ---------------- payment verification: request information ----------------

def test_request_information_round_trip(client, session, world, superadmin_headers):
    res = client.post(f"{COOP}/sms-credits/payments", headers=world["admin_a"], json={
        "credits": 1000, "amount_kes": 800, "mpesa_reference": "QWE3H2L9QX",
    })
    payment = res.json()
    url = f"{SA}/payments/{payment['id']}"
    assert client.post(f"{url}/request-information", json={"message": "no"}, headers=superadmin_headers).status_code == 422
    asked = client.post(f"{url}/request-information", json={"message": "Send the till statement line, please."}, headers=superadmin_headers)
    assert asked.status_code == 200 and asked.json()["status"] == "AWAITING_INFORMATION"
    # Can't ask twice while waiting; the cooperative sees the question.
    assert client.post(f"{url}/request-information", json={"message": "Again please"}, headers=superadmin_headers).status_code == 409
    mine = client.get(f"{COOP}/sms-credits", headers=world["admin_a"]).json()["payments"][0]
    assert mine["status"] == "AWAITING_INFORMATION" and mine["info_request"].startswith("Send the till")
    # Only this cooperative's admin can answer.
    respond = f"{COOP}/sms-credits/payments/{payment['id']}/respond"
    assert client.post(respond, json={"response": "Paid at 10:42"}, headers=world["admin_b"]).status_code == 404
    assert client.post(respond, json={"response": "Paid at 10:42"}, headers=world["col_a"]).status_code == 403
    answered = client.post(respond, json={"response": "Paid at 10:42 from 0712..."}, headers=world["admin_a"])
    assert answered.status_code == 200 and answered.json()["status"] == "PENDING"
    assert client.post(f"{url}/action", json={"action": "VERIFY"}, headers=superadmin_headers).json()["status"] == "VERIFIED"
    actions = [a.action for a in session.query(AuditLog).filter_by(entity_type="payment").order_by(AuditLog.created_at)]
    assert actions == ["PAYMENT_SUBMITTED", "PAYMENT_INFO_REQUESTED", "PAYMENT_INFO_PROVIDED", "PAYMENT_VERIFIED"]


# ---------------- the farmer's own view ----------------

def test_farmer_sees_only_their_own_collections_with_prices(client, session, world):
    assert client.post(f"{COOP}/prices", json={"price_per_kg": 50, "effective_from": "2020-01-01"}, headers=world["admin_a"]).status_code == 201
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10), (world["peter"], 5)], captured=15))
    jane_user = make_user(session, world["a"], UserRole.FARMER, "jane@farm.ke", "+254712345601")
    from models.farmer import Farmer

    session.get(Farmer, uuid.UUID(world["jane"]["id"])).user_id = jane_user.id
    session.commit()
    h = headers_for(client, "jane@farm.ke")
    page = client.get(f"{FARMER}/collections", headers=h).json()
    assert page["total"] == 1
    line = page["items"][0]
    assert line["quantity_kg"] == 10 and line["price_per_kg"] == 50 and line["amount"] == 500 and line["price_is_estimate"] is True
    detail = client.get(f"{FARMER}/collections/{line['id']}", headers=h).json()
    assert detail["batch_reference"] == batch["reference"] and detail["collector_name"]
    peter_line = next(l for l in batch["lines"] if l["farmer_id"] == world["peter"]["id"])
    assert client.get(f"{FARMER}/collections/{peter_line['id']}", headers=h).status_code == 404
    dash = client.get(f"{FARMER}/dashboard?range=7d", headers=h).json()
    assert dash["today"]["kg"] == 10 and dash["totals"]["earnings"] == 500
    # Other roles can't use the farmer API, and farmers can't use the staff ones.
    assert client.get(f"{FARMER}/dashboard", headers=world["col_a"]).status_code == 403
    assert client.get(f"{COOP}/farmers", headers=h).status_code == 403
    assert client.post(BATCHES, json=batch_body(world, [(world["jane"], 1)], captured=1), headers=h).status_code == 403


# ---------------- cross-cooperative isolation ----------------

def test_cooperative_a_can_not_reach_cooperative_b(client, session, world):
    b = world["admin_b"]
    farmer_a = world["jane"]
    batch_a = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    user_a = session.query(User).filter_by(email="col@a.coop").one()
    checks = [
        ("PATCH", f"{COOP}/farmers/{farmer_a['id']}"),
        ("GET", f"{BATCHES}/{batch_a['id']}"),
        ("POST", f"{COOP}/accounts/{user_a.id}/resend-activation"),
        ("POST", f"{COOP}/accounts/{user_a.id}/send-password-reset"),
        ("PATCH", f"{COOP}/team/{user_a.id}"),
        ("PATCH", f"{COOP}/coolers/{world['cooler_a']['id']}"),
        ("GET", f"{COOP}/coolers/{world['cooler_a']['id']}/readings"),
    ]
    for method, path in checks:
        res = client.request(method, path, json={}, headers=b)
        assert res.status_code in (403, 404), (method, path, res.status_code)
    # A cooperative id in the request is never trusted.
    assert client.post(BATCHES, json={**batch_body(world, [(world["jane"], 1)], captured=1), "cooperative_id": str(world["b"].id)},
                       headers=world["admin_a"]).status_code in (403, 422)
    assert all(a["id"] != str(user_a.id) for a in client.get(f"{COOP}/accounts", headers=b).json())
    assert client.get(f"{COOP}/sms-credits", headers=b).json()["balance"] == 0
    reports = client.get("/api/v1/reports/collections?format=json", headers=b)
    assert reports.status_code in (200, 404) and str(farmer_a["id"]) not in reports.text


def test_dashboard_trend_ranges(client, world):
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    for rng, days in (("today", 1), ("7d", 7), ("30d", 30), ("3m", 90)):
        res = client.get(f"{COOP}/trends?range={rng}", headers=world["admin_a"]).json()
        assert len(res["trend"]) == days and res["totals"]["kg"] == 10
    custom = client.get(f"{COOP}/trends?range=custom&date_from=2026-01-01&date_to=2026-01-10", headers=world["manager_a"]).json()
    assert len(custom["trend"]) == 10 and custom["from"] == "2026-01-01" and custom["totals"]["kg"] == 0
    assert client.get(f"{COOP}/trends?range=custom&date_from=2026-02-01&date_to=2026-01-01", headers=world["admin_a"]).status_code == 422
    assert client.get(f"{COOP}/trends?range=custom", headers=world["admin_a"]).status_code == 422
    # Another cooperative sees only its own (empty) figures; collectors can't use the staff dashboard.
    assert client.get(f"{COOP}/trends?range=7d", headers=world["admin_b"]).json()["totals"]["kg"] == 0
    assert client.get(f"{COOP}/trends?range=7d", headers=world["col_a"]).status_code == 403
