"""SMS credit ledger, SMS credit center, milk pricing, farmer payments and their interaction with corrections."""
import datetime
import io
import uuid
import zipfile

import pytest

from models.admin import AuditLog, SMSCreditPayment
from models.cooperative import Cooperative
from models.finance import CreditTxn, SmsCreditTransaction
from services import sms, sms_credits
from tests.test_batches import BATCHES, COOP, REQUESTS, batch_body, confirm, correction_body, world  # noqa: F401
from tests.test_sync import FakeSms, grant_credits

SA = "/api/v1/superadmin"
TODAY = datetime.date.today()
DAY = datetime.timedelta(days=1)


# ---------------- ledger ----------------

def test_ledger_reserve_consume_refund_are_idempotent(session, world):
    coop = world["a"]
    grant_credits(session, coop, 3)
    assert sms_credits.reserve(session, coop.id, "sms:x:1") is True
    assert sms_credits.reserve(session, coop.id, "sms:x:1") is True  # same attempt: not held twice
    session.commit()
    b = sms_credits.balances(session, coop.id)
    assert (b["available"], b["reserved"], b["balance"]) == (2, 1, 3)
    assert sms_credits.consume(session, coop.id, "sms:x:1") is True
    assert sms_credits.consume(session, coop.id, "sms:x:1") is False  # settled once
    assert sms_credits.refund(session, coop.id, "sms:x:1") is False   # ...and never both
    sms_credits.reserve(session, coop.id, "sms:y:1")
    assert sms_credits.refund(session, coop.id, "sms:y:1") is True
    session.commit()
    b = sms_credits.balances(session, coop.id)
    assert (b["available"], b["reserved"], b["consumed"], b["refunded"]) == (2, 0, 1, 1)
    session.expire_all()
    assert session.get(Cooperative, coop.id).sms_credit_balance == 2  # cache follows the ledger
    # Can't reserve more than is available.
    assert sms_credits.reserve(session, coop.id, "sms:z:1", credits=5) is False
    assert session.query(SmsCreditTransaction).filter_by(reference="sms:z:1").count() == 0


def test_verified_payment_credits_once_and_rejected_or_cancelled_never(client, session, world, superadmin_headers):
    pay = lambda code: client.post(f"{COOP}/sms-credits/payments", json={"credits": 100, "amount_kes": 500, "mpesa_reference": code}, headers=world["admin_a"])
    first, second, third = pay("SJK3H2L9QA").json(), pay("SJK3H2L9QB").json(), pay("SJK3H2L9QC").json()
    # Pending payments add nothing.
    assert client.get(f"{COOP}/sms-credits/center", headers=world["admin_a"]).json()["balances"]["available"] == 0
    assert client.post(f"{SA}/payments/{first['id']}/action", json={"action": "VERIFY"}, headers=superadmin_headers).status_code == 200
    again = client.post(f"{SA}/payments/{first['id']}/action", json={"action": "VERIFY"}, headers=superadmin_headers)
    assert again.status_code == 409
    client.post(f"{SA}/payments/{second['id']}/action", json={"action": "REJECT", "reason": "Code not on statement"}, headers=superadmin_headers)
    cancelled = client.post(f"{COOP}/sms-credits/payments/{third['id']}/cancel", json={"reason": "Typed the wrong code"}, headers=world["admin_a"])
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    # A cancelled payment can't then be verified.
    assert client.post(f"{SA}/payments/{third['id']}/action", json={"action": "VERIFY"}, headers=superadmin_headers).status_code == 409

    center = client.get(f"{COOP}/sms-credits/center", headers=world["admin_a"]).json()
    assert center["balances"]["available"] == 100 and center["balances"]["purchased"] == 100
    assert [t["transaction_type"] for t in center["transactions"]["items"]] == ["PURCHASE"]
    assert session.query(AuditLog).filter(AuditLog.action.in_(["PAYMENT_VERIFIED", "PAYMENT_CANCELLED"])).count() == 2
    # Another cooperative can't cancel A's payment.
    other = client.post(f"{COOP}/sms-credits/payments/{first['id']}/cancel", json={"reason": "Not mine at all"}, headers=world["admin_b"])
    assert other.status_code == 404


def test_platform_adjustment_goes_through_the_ledger(client, session, world, superadmin_headers):
    res = client.post(f"{SA}/cooperatives/{world['a'].id}/sms-credits", json={"delta": 50, "reason": "Welcome bonus"}, headers=superadmin_headers)
    assert res.status_code == 200 and res.json()["sms_credit_balance"] == 50
    too_much = client.post(f"{SA}/cooperatives/{world['a'].id}/sms-credits", json={"delta": -60, "reason": "Correction"}, headers=superadmin_headers)
    assert too_much.status_code == 422
    entry = session.query(SmsCreditTransaction).filter_by(transaction_type=CreditTxn.ADJUSTMENT).one()
    assert entry.amount == 50 and entry.reason == "Welcome bonus"


def test_credit_center_is_tenant_scoped_and_read_only_for_managers(client, world):
    assert client.get(f"{COOP}/sms-credits/center", headers=world["manager_a"]).status_code == 200
    assert client.get(f"{COOP}/sms-credits/center", headers=world["col_a"]).status_code == 403
    bought = client.post(f"{COOP}/sms-credits/payments", json={"credits": 10, "amount_kes": 50, "mpesa_reference": "SJK3H2L9QD"}, headers=world["manager_a"])
    assert bought.status_code == 403


# ---------------- pricing ----------------

def price(client, headers, start, value, end=None):
    return client.post(f"{COOP}/prices", json={"effective_from": start.isoformat(), "price_per_kg": value,
                                               **({"effective_to": end.isoformat()} if end else {})}, headers=headers)


def test_prices_close_the_previous_one_and_never_overlap(client, world):
    first = price(client, world["admin_a"], TODAY - 60 * DAY, 45)
    assert first.status_code == 201
    second = price(client, world["admin_a"], TODAY - 30 * DAY, 50)
    assert second.status_code == 201
    listed = client.get(f"{COOP}/prices", headers=world["admin_a"]).json()
    by_price = {p["price_per_kg"]: p for p in listed["items"]}
    assert by_price[45]["effective_to"] == (TODAY - 31 * DAY).isoformat()  # closed, not edited otherwise
    assert listed["current"]["price_per_kg"] == 50
    # Overlapping a closed window is refused.
    assert price(client, world["admin_a"], TODAY - 45 * DAY, 47).status_code == 422
    applicable = client.get(f"{COOP}/prices/applicable", params={"date": (TODAY - 40 * DAY).isoformat()}, headers=world["admin_a"]).json()
    assert applicable["price"]["price_per_kg"] == 45
    # Managers read, admins manage; other cooperatives see nothing.
    assert price(client, world["manager_a"], TODAY, 60).status_code == 403
    assert client.get(f"{COOP}/prices", headers=world["admin_b"]).json()["items"] == []


# ---------------- farmer payments ----------------

def _generate(client, headers, start, end):
    return client.post(f"{COOP}/farmer-payments/generate", json={"period_start": start.isoformat(), "period_end": end.isoformat()}, headers=headers)


def test_payment_calculation_uses_the_price_of_each_collection_date(client, world):
    price(client, world["admin_a"], TODAY - 10 * DAY, 40)
    price(client, world["admin_a"], TODAY - 2 * DAY, 50)
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10), (world["peter"], 5)], captured=15, collection_date=(TODAY - 5 * DAY).isoformat()))
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 4)], captured=4, collection_date=TODAY.isoformat()))
    confirm(client, world["admin_a"], batch_body(world, [(world["mary"], 7)], captured=7, quality_status="REJECTED", rejection_reason="Sour milk"))

    preview = client.post(f"{COOP}/farmer-payments/preview", json={"period_start": (TODAY - 10 * DAY).isoformat(), "period_end": TODAY.isoformat()},
                          headers=world["manager_a"]).json()
    assert preview["gross_amount"] == 10 * 40 + 5 * 40 + 4 * 50 and preview["missing_price_dates"] == []
    assert _generate(client, world["manager_a"], TODAY - 10 * DAY, TODAY).status_code == 403  # managers can't generate
    result = _generate(client, world["admin_a"], TODAY - 10 * DAY, TODAY)
    assert result.status_code == 201, result.text
    payments = {p["farmer_number"]: p for p in result.json()["created"]}
    assert set(payments) == {world["jane"]["farmer_number"], world["peter"]["farmer_number"]}  # rejected milk isn't paid
    jane = payments[world["jane"]["farmer_number"]]
    assert jane["total_kg"] == 14 and jane["gross_amount"] == 600 and jane["net_amount"] == 600 and jane["status"] == "PENDING"
    detail = client.get(f"{COOP}/farmer-payments/{jane['id']}", headers=world["admin_a"]).json()
    assert sorted((l["quantity_kg"], l["price_per_kg"]) for l in detail["lines"]) == [(4, 50), (10, 40)]
    # Generating again creates nothing new (the milk is already in a payment).
    assert _generate(client, world["admin_a"], TODAY - 10 * DAY, TODAY).json()["created"] == []

    # Old pricing is kept: a used price can't be cancelled.
    used = next(p for p in client.get(f"{COOP}/prices", headers=world["admin_a"]).json()["items"] if p["price_per_kg"] == 40)
    assert used["used_by_payments"] is True
    assert client.post(f"{COOP}/prices/{used['id']}/cancel", json={"reason": "Mistake in price"}, headers=world["admin_a"]).status_code == 409
    # ...and no new price may start inside the paid period.
    assert price(client, world["admin_a"], TODAY - DAY, 55).status_code == 409


def test_missing_price_blocks_generation(client, world):
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    res = _generate(client, world["admin_a"], TODAY - DAY, TODAY)
    assert res.status_code == 422 and "No milk price" in str(res.json())


def test_payment_status_rules(client, world):
    price(client, world["admin_a"], TODAY - DAY, 50)
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    [payment] = _generate(client, world["admin_a"], TODAY - DAY, TODAY).json()["created"]
    url = f"{COOP}/farmer-payments/{payment['id']}"
    # Paid needs a real transaction reference; nothing is marked paid by itself.
    assert client.post(f"{url}/status", json={"status": "PAID"}, headers=world["admin_a"]).status_code == 422
    # No payout provider: initiating is refused rather than faked.
    assert client.post(f"{url}/initiate", headers=world["admin_a"]).status_code == 409
    paid = client.post(f"{url}/status", json={"status": "PAID", "payment_reference": "QWE123RTY"}, headers=world["admin_a"])
    assert paid.status_code == 200 and paid.json()["status"] == "PAID" and paid.json()["paid_at"]
    assert client.post(f"{url}/status", json={"status": "CANCELLED", "reason": "Too late"}, headers=world["admin_a"]).status_code == 409
    assert client.get(url, headers=world["admin_b"]).status_code == 404


def test_cancelled_payment_releases_its_milk(client, world):
    price(client, world["admin_a"], TODAY - DAY, 50)
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    [payment] = _generate(client, world["admin_a"], TODAY - DAY, TODAY).json()["created"]
    client.post(f"{COOP}/farmer-payments/{payment['id']}/status", json={"status": "CANCELLED", "reason": "Wrong period"}, headers=world["admin_a"])
    [again] = _generate(client, world["admin_a"], TODAY - DAY, TODAY).json()["created"]
    assert again["net_amount"] == 500 and again["id"] != payment["id"]


def test_correcting_paid_milk_creates_an_adjustment_for_the_next_payment(client, world):
    price(client, world["admin_a"], TODAY - 20 * DAY, 50)
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10)], captured=10, collection_date=(TODAY - 10 * DAY).isoformat()))
    [first] = _generate(client, world["admin_a"], TODAY - 15 * DAY, TODAY - 8 * DAY).json()["created"]
    client.post(f"{COOP}/farmer-payments/{first['id']}/status", json={"status": "PAID", "payment_reference": "PAID0001"}, headers=world["admin_a"])
    assert first["net_amount"] == 500

    # The collection is corrected to 8 KG after it was paid.
    request = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 8)], 10), headers=world["col_a"]).json()
    client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["admin_a"])
    adjustments = client.get(f"{COOP}/farmer-payments/adjustments", headers=world["admin_a"]).json()["items"]
    assert [a["amount"] for a in adjustments] == [-500] and adjustments[0]["status"] == "PENDING"

    # Next run: the corrected 8 KG (carried forward from its own date) minus the 500 already paid.
    [second] = _generate(client, world["admin_a"], TODAY - 7 * DAY, TODAY).json()["created"]
    assert second["gross_amount"] == 400 and second["adjustments_amount"] == -500 and second["net_amount"] == -100
    # The original payment is untouched.
    assert client.get(f"{COOP}/farmer-payments/{first['id']}", headers=world["admin_a"]).json()["net_amount"] == 500


def test_reversing_paid_milk_recovers_it(client, world):
    price(client, world["admin_a"], TODAY - 20 * DAY, 50)
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 6)], captured=6, collection_date=(TODAY - 10 * DAY).isoformat()))
    _generate(client, world["admin_a"], TODAY - 15 * DAY, TODAY - 8 * DAY)
    request = client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Never delivered"}, headers=world["manager_a"]).json()
    client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["admin_a"])
    adjustments = client.get(f"{COOP}/farmer-payments/adjustments?status=PENDING", headers=world["admin_a"]).json()["items"]
    assert [a["amount"] for a in adjustments] == [-300] and adjustments[0]["source_type"] == "REVERSAL"


# ---------------- reports, inbox, search ----------------

def test_reports_are_scoped_and_permissioned(client, world, superadmin_headers):
    confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 12)], captured=12))
    rep = client.get("/api/v1/reports/collections", headers=world["manager_a"]).json()
    assert rep["row_count"] == 1 and rep["summary"]["accepted_kg"] == 12
    assert client.get("/api/v1/reports/collections", headers=world["admin_b"]).json()["row_count"] == 0
    assert client.get("/api/v1/reports/collections", params={"cooperative_id": str(world["a"].id)}, headers=world["admin_b"]).status_code == 403
    assert client.get("/api/v1/reports/audit", headers=world["manager_a"]).status_code == 403  # needs audit access
    assert client.get("/api/v1/reports/audit", headers=world["admin_a"]).status_code == 200
    assert client.get("/api/v1/reports/collections", headers=world["col_a"]).status_code == 403
    platform = client.get("/api/v1/reports/collections", params={"cooperative_id": str(world["a"].id)}, headers=superadmin_headers)
    assert platform.status_code == 200 and platform.json()["row_count"] == 1
    for kind in ("farmers", "collectors", "coolers", "centres", "sms", "payments", "pricing", "corrections", "reversals", "sync", "summary"):
        assert client.get(f"/api/v1/reports/{kind}", headers=world["admin_a"]).status_code == 200, kind

    csv = client.get("/api/v1/reports/collections", params={"format": "csv"}, headers=world["admin_a"])
    assert csv.status_code == 200 and "text/csv" in csv.headers["content-type"] and "Farmer no." in csv.text
    xlsx = client.get("/api/v1/reports/farmers", params={"format": "xlsx"}, headers=world["admin_a"])
    assert xlsx.status_code == 200
    with zipfile.ZipFile(io.BytesIO(xlsx.content)) as z:
        assert "xl/worksheets/sheet1.xml" in z.namelist() and "Jane" in z.read("xl/worksheets/sheet1.xml").decode()


def test_inbox_is_scoped_to_role_and_cooperative(client, world, superadmin_headers):
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 12)], captured=12))
    client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Entered twice"}, headers=world["col_a"])
    admin_inbox = client.get("/api/v1/inbox", headers=world["admin_a"]).json()
    assert any(n["type"] == "REVERSAL_REQUESTED" for n in admin_inbox["items"]) and admin_inbox["unread"] >= 1
    # Reversal approvals go to admins only; other cooperatives and platform staff see nothing of it.
    assert not any(n["type"] == "REVERSAL_REQUESTED" for n in client.get("/api/v1/inbox", headers=world["manager_a"]).json()["items"])
    assert client.get("/api/v1/inbox", headers=world["admin_b"]).json()["total"] == 0
    assert not any(n["type"] == "REVERSAL_REQUESTED" for n in client.get("/api/v1/inbox", headers=superadmin_headers).json()["items"])
    marked = client.post("/api/v1/inbox/read", json={}, headers=world["admin_a"]).json()["marked"]
    assert marked >= 1 and client.get("/api/v1/inbox/count", headers=world["admin_a"]).json()["unread"] == 0


def test_workspace_search_respects_tenant_and_role(client, world):
    batch = confirm(client, world["col2_a"], batch_body(world, [(world["jane"], 12)], captured=12))
    found = client.get("/api/v1/search", params={"q": batch["reference"]}, headers=world["admin_a"]).json()["results"]
    assert any(r["type"] == "BATCH" and r["id"] == batch["id"] for r in found)
    assert client.get("/api/v1/search", params={"q": batch["reference"]}, headers=world["admin_b"]).json()["results"] == []
    # Another collector's batch is invisible to this collector.
    assert client.get("/api/v1/search", params={"q": batch["reference"]}, headers=world["col_a"]).json()["results"] == []
    farmers = client.get("/api/v1/search", params={"q": "Jane"}, headers=world["col_a"]).json()["results"]
    assert any(r["type"] == "FARMER" for r in farmers)
