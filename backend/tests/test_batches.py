"""Collection batches: multi-farmer allocation, validation, tenant isolation, collector authorization,
idempotency, immutability, SMS receipts, corrections and reversals (maker-checker)."""
import datetime
import uuid

import pytest

from models.admin import AuditLog
from models.notifications import Notification
from models.operations import CollectionBatch, LineStatus, MilkCollection
from schemas.auth import UserRole
from services import sms
from services.immutability import ImmutableRecordError
from tests.test_cooperative_module import headers_for, make_coop, make_user
from tests.test_sync import FakeSms, grant_credits, h, mutation, push, register

BATCHES = "/api/v1/collection-batches"
REQUESTS = "/api/v1/collection-requests"
COOP = "/api/v1/cooperative"
COLL = "/api/v1/collections"


@pytest.fixture(autouse=True)
def _sms(monkeypatch):
    monkeypatch.setenv("SYNC_SETTLE_SECONDS", "0")
    sms.reset_provider()
    yield
    sms.reset_provider()


def _farmer(client, headers, first, phone, **extra):
    res = client.post(f"{COOP}/farmers", json={"first_name": first, "last_name": "Test", "phone": phone, **extra}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture
def world(client, session):
    from services.collectors import ensure_profile

    a, b = make_coop(session, 1), make_coop(session, 2)
    make_user(session, a, UserRole.COOP_ADMIN, "admin@a.coop", "+254700000011")
    make_user(session, a, UserRole.MANAGER, "manager@a.coop", "+254700000012")
    collector_user = make_user(session, a, UserRole.COLLECTOR, "col@a.coop", "+254700000013")
    other_collector_user = make_user(session, a, UserRole.COLLECTOR, "col2@a.coop", "+254700000014")
    make_user(session, b, UserRole.COOP_ADMIN, "admin@b.coop", "+254700000021")
    profile = ensure_profile(session, collector_user)
    other = ensure_profile(session, other_collector_user)
    session.commit()
    w = {
        "a": a, "b": b, "collector": profile, "other_collector": other,
        "admin_a": headers_for(client, "admin@a.coop"), "manager_a": headers_for(client, "manager@a.coop"),
        "col_a": headers_for(client, "col@a.coop"), "col2_a": headers_for(client, "col2@a.coop"),
        "admin_b": headers_for(client, "admin@b.coop"),
    }
    w["cooler_a"] = client.post(f"{COOP}/coolers", json={"name": "Kiserian Cooler", "capacity_litres": 5000}, headers=w["admin_a"]).json()
    w["cooler_b"] = client.post(f"{COOP}/coolers", json={"name": "Other Cooler"}, headers=w["admin_b"]).json()
    w["centre_a"] = client.post(f"{COOP}/centres", json={"name": "Kiserian Centre"}, headers=w["admin_a"]).json()
    w["jane"] = _farmer(client, w["admin_a"], "Jane", "0712345601")
    w["peter"] = _farmer(client, w["admin_a"], "Peter", "0712345602")
    w["mary"] = _farmer(client, w["admin_a"], "Mary", "0712345603")
    w["bob_b"] = _farmer(client, w["admin_b"], "Bob", "0712345604")
    return w


def batch_body(w, allocations, captured=248.5, **extra):
    return {
        "cooler_id": w["cooler_a"]["id"], "centre_id": w["centre_a"]["id"], "captured_weight_kg": captured,
        "weight_source": "SCALE", "scale_name": "Test scale", "scale_identifier": "mock-scale-1",
        "allocations": [{"farmer_id": f["id"], "quantity_kg": kg} for f, kg in allocations], **extra,
    }


def confirm(client, headers, body, expect=201):
    res = client.post(BATCHES, json=body, headers=headers)
    assert res.status_code == expect, res.text
    return res.json()


# ---------------- creation & allocation ----------------

def test_multi_farmer_batch_is_one_transaction_with_lines(client, session, world):
    body = batch_body(world, [(world["jane"], 80), (world["peter"], 65), (world["mary"], 50)])
    batch = confirm(client, world["col_a"], body)
    assert batch["status"] == "CONFIRMED" and batch["reference"].startswith("CB-")
    assert batch["captured_weight_kg"] == 248.5 and batch["allocated_weight_kg"] == 195 and batch["remaining_weight_kg"] == 53.5
    assert batch["collector_id"] == str(world["collector"].id)  # always the caller's own profile
    assert batch["weight_source"] == "SCALE" and batch["scale_name"] == "Test scale"
    assert [(l["farmer_name"], l["quantity_kg"]) for l in batch["lines"]] != []
    assert sorted(l["quantity_kg"] for l in batch["lines"]) == [50, 65, 80]
    lines = session.query(MilkCollection).filter_by(batch_id=uuid.UUID(batch["id"])).all()
    assert len(lines) == 3 and all(l.record_status == LineStatus.ACTIVE for l in lines)
    # Litres are derived from KG with the recorded density (1.03 by default).
    jane = next(l for l in lines if str(l.farmer_id) == world["jane"]["id"])
    assert float(jane.quantity_kg) == 80 and float(jane.quantity_litres) == 77.67
    audit = session.query(AuditLog).filter_by(action="COLLECTION_CONFIRMED").one()
    assert audit.new_values["allocated_weight_kg"] == 195 and len(audit.new_values["allocations"]) == 3

    # The per-farmer lines show up in the existing collections API (and its kg-aware summary).
    page = client.get(COLL, headers=world["admin_a"]).json()
    assert page["total"] == 3 and page["summary"]["accepted_kg"] == 195


@pytest.mark.parametrize("allocations,captured,field", [
    ([("jane", 200), ("peter", 60)], 248.5, "allocations"),          # over-allocated
    ([("jane", 0)], 100, "quantity_kg"),                             # zero
    ([("jane", -5)], 100, "quantity_kg"),                            # negative
    ([("jane", 10), ("jane", 10)], 100, "allocations"),              # same farmer twice
    ([], 100, "allocations"),                                        # nobody
])
def test_invalid_allocations_are_refused(client, world, allocations, captured, field):
    body = batch_body(world, [(world[name], kg) for name, kg in allocations], captured=captured)
    res = client.post(BATCHES, json=body, headers=world["col_a"])
    assert res.status_code == 422, res.text
    assert field in str(res.json()["detail"])


def test_exact_allocation_and_rounding_edge(client, world):
    body = batch_body(world, [(world["jane"], 100.01), (world["peter"], 148.49)], captured=248.5)
    # Exactly the captured weight: allowed, nothing remaining.
    batch = confirm(client, world["admin_a"], body)
    assert batch["remaining_weight_kg"] == 0
    over = batch_body(world, [(world["jane"], 100.02), (world["peter"], 148.49)], captured=248.5)
    assert client.post(BATCHES, json=over, headers=world["admin_a"]).status_code == 422


def test_manual_weight_is_labelled_and_never_names_a_scale(client, session, world):
    body = batch_body(world, [(world["jane"], 20)], captured=20, weight_source="MANUAL")
    assert client.post(BATCHES, json=body, headers=world["col_a"]).status_code == 422  # still names a scale
    body.pop("scale_name"), body.pop("scale_identifier")
    batch = confirm(client, world["col_a"], body)
    assert batch["weight_source"] == "MANUAL" and batch["scale_name"] is None
    # Staff are told about manually typed weights.
    from models.inbox import InboxNotification

    assert session.query(InboxNotification).filter_by(type="MANUAL_WEIGHT").count() == 1


# ---------------- tenant isolation & authorization ----------------

def test_references_must_belong_to_the_callers_cooperative(client, world):
    other_farmer = batch_body(world, [(world["bob_b"], 10)], captured=10)
    assert client.post(BATCHES, json=other_farmer, headers=world["admin_a"]).status_code == 422
    other_cooler = {**batch_body(world, [(world["jane"], 10)], captured=10), "cooler_id": world["cooler_b"]["id"]}
    assert client.post(BATCHES, json=other_cooler, headers=world["admin_a"]).status_code == 422
    named_coop = {**batch_body(world, [(world["jane"], 10)], captured=10), "cooperative_id": str(world["b"].id)}
    assert client.post(BATCHES, json=named_coop, headers=world["admin_a"]).status_code == 403
    # Cooperative B can't see (or address) cooperative A's batch.
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    assert client.get(f"{BATCHES}/{batch['id']}", headers=world["admin_b"]).status_code == 404
    assert client.get(BATCHES, headers=world["admin_b"]).json()["total"] == 0
    assert client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Not ours at all"}, headers=world["admin_b"]).status_code == 404


def test_collectors_record_as_themselves_and_see_only_their_batches(client, world):
    impersonate = {**batch_body(world, [(world["jane"], 10)], captured=10), "collector_id": str(world["other_collector"].id)}
    assert client.post(BATCHES, json=impersonate, headers=world["col_a"]).status_code == 403
    mine = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    theirs = confirm(client, world["col2_a"], batch_body(world, [(world["peter"], 12)], captured=12))
    listed = client.get(BATCHES, headers=world["col_a"]).json()
    assert [b["id"] for b in listed["items"]] == [mine["id"]]
    assert client.get(f"{BATCHES}/{theirs['id']}", headers=world["col_a"]).status_code == 404
    # Staff see both, and may record for a named collector.
    assert client.get(BATCHES, headers=world["manager_a"]).json()["total"] == 2
    for_collector = {**batch_body(world, [(world["mary"], 5)], captured=5), "collector_id": str(world["collector"].id)}
    assert confirm(client, world["manager_a"], for_collector)["collector_id"] == str(world["collector"].id)


def test_superadmin_and_farmers_cannot_record(client, session, world, superadmin_headers):
    assert client.post(BATCHES, json=batch_body(world, [(world["jane"], 1)], captured=1), headers=superadmin_headers).status_code == 403
    make_user(session, world["a"], UserRole.FARMER, "farmer@a.coop", "+254700000015")
    farmer_h = headers_for(client, "farmer@a.coop")
    assert client.post(BATCHES, json=batch_body(world, [(world["jane"], 1)], captured=1), headers=farmer_h).status_code == 403


# ---------------- idempotency ----------------

def test_resending_the_same_batch_never_duplicates(client, session, world):
    body = {**batch_body(world, [(world["jane"], 30), (world["peter"], 20)], captured=50), "id": str(uuid.uuid4())}
    first = confirm(client, world["col_a"], body)
    again = confirm(client, world["col_a"], body)
    assert again["id"] == first["id"] and again["reference"] == first["reference"]
    assert session.query(CollectionBatch).count() == 1 and session.query(MilkCollection).count() == 2


def test_offline_batch_push_is_idempotent_and_reuses_device_ids(client, session, world):
    device, _ = register(client, world["col_a"])
    batch_id, line_id = uuid.uuid4(), uuid.uuid4()
    payload = batch_body(world, [(world["jane"], 40)], captured=41.5)
    payload["allocations"][0]["id"] = str(line_id)
    m = mutation("collection_batch", payload, local_id=batch_id)
    [first] = push(client, world["col_a"], device, m)
    assert first["status"] == "applied" and first["server_id"] == str(batch_id)
    assert first["entity"]["lines"][0]["id"] == str(line_id)
    [again] = push(client, world["col_a"], device, m)  # same mutation (lost response)
    assert again["status"] == "duplicate"
    [resent] = push(client, world["col_a"], device, mutation("collection_batch", payload, local_id=batch_id))  # new mutation id
    assert resent["status"] == "duplicate" and session.query(CollectionBatch).count() == 1
    row = session.get(CollectionBatch, batch_id)
    assert row.device_id is not None and row.client_recorded_at is not None

    # The batch reaches the device on pull (and only the collector's own).
    from tests.test_sync import pull_all

    changes, _ = pull_all(client, world["col_a"], device)
    pulled = [c for c in changes if c["entity_type"] == "collection_batch"]
    assert [c["entity_id"] for c in pulled] == [str(batch_id)]


def test_offline_batch_validation_failures_are_rejected_not_retried(client, world):
    device, _ = register(client, world["col_a"])
    payload = batch_body(world, [(world["jane"], 60)], captured=50)
    [res] = push(client, world["col_a"], device, mutation("collection_batch", payload))
    assert res["status"] == "rejected" and res["error"]["code"] == "validation"


# ---------------- immutability ----------------

def test_confirmed_collections_are_immutable(client, session, world):
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 30)], captured=30))
    line_id = batch["lines"][0]["id"]
    res = client.patch(f"{COLL}/{line_id}", json={"quantity_litres": 99}, headers=world["admin_a"])
    assert res.status_code == 409 and "correction" in res.json()["detail"]

    # Even code that bypasses the services can't overwrite or delete history.
    line = session.get(MilkCollection, uuid.UUID(line_id))
    line.quantity_kg = 1
    with pytest.raises(ImmutableRecordError):
        session.flush()
    session.rollback()
    row = session.get(CollectionBatch, uuid.UUID(batch["id"]))
    session.delete(row)
    with pytest.raises(ImmutableRecordError):
        session.flush()
    session.rollback()


def test_pending_lab_result_can_be_completed_once(client, world):
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 30)], captured=30, quality_status="PENDING"))
    line_id = batch["lines"][0]["id"]
    res = client.patch(f"{COLL}/{line_id}", json={"quality_status": "ACCEPTED", "fat_percentage": 4.2}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["quality_status"] == "ACCEPTED" and res.json()["fat_percentage"] == 4.2
    again = client.patch(f"{COLL}/{line_id}", json={"quality_status": "REJECTED", "rejection_reason": "Sour"}, headers=world["admin_a"])
    assert again.status_code == 409


# ---------------- SMS receipts ----------------

def test_receipts_sent_only_when_the_provider_accepts(client, session, world):
    fake = FakeSms()
    sms.set_provider(fake)
    grant_credits(session, world["a"], 5)
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 25.5), (world["peter"], 10)], captured=40))
    receipts = session.query(Notification).filter_by(type="COLLECTION_RECEIPT").all()
    assert len(receipts) == 2 and all(n.status == "SENT" for n in receipts)
    assert {to for to, _ in fake.sent} == {"+254712345601", "+254712345602"}
    jane_msg = next(m for to, m in fake.sent if to == "+254712345601")
    assert "25.50 KG" in jane_msg and "Kiserian Centre" in jane_msg and "MC-" in jane_msg
    detail = client.get(f"{BATCHES}/{batch['id']}", headers=world["col_a"]).json()
    assert {l["receipt_status"] for l in detail["lines"]} == {"SENT"}

    from services import sms_credits

    balances = sms_credits.balances(session, world["a"].id)
    assert balances["available"] == 3 and balances["consumed"] == 2 and balances["reserved"] == 0


def test_receipts_without_provider_or_credits_are_never_sent(client, session, world):
    sms.set_provider(None)
    grant_credits(session, world["a"], 5)
    confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    n = session.query(Notification).filter_by(type="COLLECTION_RECEIPT").one()
    assert n.status == "PENDING_PROVIDER" and n.sent_at is None

    sms.set_provider(FakeSms(accept=False))
    confirm(client, world["col_a"], batch_body(world, [(world["peter"], 10)], captured=10))
    failed = session.query(Notification).filter_by(type="COLLECTION_RECEIPT", farmer_id=uuid.UUID(world["peter"]["id"])).one()
    assert failed.status == "FAILED" and failed.sent_at is None

    from services import sms_credits

    # Every reservation was refunded: nothing lost.
    assert sms_credits.balances(session, world["a"].id)["available"] == 5


def test_receipts_can_be_switched_off(client, session, world):
    sms.set_provider(FakeSms())
    res = client.patch(f"{COOP}/sms-settings", json={"receipt_sms_enabled": False}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["receipt_sms_enabled"] is False
    assert client.patch(f"{COOP}/sms-settings", json={"receipt_sms_enabled": True}, headers=world["manager_a"]).status_code == 403
    confirm(client, world["col_a"], batch_body(world, [(world["jane"], 10)], captured=10))
    assert session.query(Notification).filter_by(type="COLLECTION_RECEIPT").count() == 0


# ---------------- corrections & reversals ----------------

def correction_body(w, allocations, captured, reason="Scale misread by the collector"):
    return {"reason": reason, "proposed": {
        "captured_weight_kg": captured, "allocations": [{"farmer_id": f["id"], "quantity_kg": kg} for f, kg in allocations],
    }}


def test_correction_supersedes_without_overwriting(client, session, world):
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 80), (world["peter"], 65)], captured=150))
    req = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 70), (world["peter"], 75)], 150),
                      headers=world["col_a"])
    assert req.status_code == 201, req.text
    request = req.json()
    assert request["status"] == "PENDING" and request["original_values"]["allocations"][0]["quantity_kg"] in (80, 65)
    assert client.get(f"{BATCHES}/{batch['id']}", headers=world["admin_a"]).json()["status"] == "CORRECTION_PENDING"
    # One open request at a time.
    dup = client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Duplicate entry"}, headers=world["admin_a"])
    assert dup.status_code == 409

    # Collectors can't approve; approved by a manager (a different person).
    assert client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["col_a"]).status_code in (403, 404)
    approved = client.post(f"{REQUESTS}/{request['id']}/approve", json={"comment": "Checked the slip"}, headers=world["manager_a"])
    assert approved.status_code == 200, approved.text
    result = approved.json()
    assert result["status"] == "APPROVED" and result["resulting_batch_reference"].startswith("CB-")

    original = client.get(f"{BATCHES}/{batch['id']}", headers=world["admin_a"]).json()
    assert original["status"] == "CORRECTED" and original["superseded_by_batch_id"] == result["resulting_batch_id"]
    assert {l["record_status"] for l in original["lines"]} == {"SUPERSEDED"}
    assert sorted(l["quantity_kg"] for l in original["lines"]) == [65, 80]  # history kept exactly
    new = client.get(f"{BATCHES}/{result['resulting_batch_id']}", headers=world["admin_a"]).json()
    assert new["status"] == "CONFIRMED" and new["supersedes_batch_id"] == batch["id"]
    assert sorted(l["quantity_kg"] for l in new["lines"]) == [70, 75]
    # Totals count only the current version.
    assert client.get(COLL, headers=world["admin_a"]).json()["summary"]["accepted_kg"] == 145
    assert client.get(f"{COLL}?include_history=true", headers=world["admin_a"]).json()["total"] == 4
    assert session.query(AuditLog).filter_by(action="COLLECTION_CORRECTION_APPROVED").count() == 1


def test_maker_checker_requester_cannot_review_own_request(client, world):
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 50)], captured=50))
    request = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 40)], 50),
                          headers=world["admin_a"]).json()
    res = client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["admin_a"])
    assert res.status_code == 403 and "own request" in res.json()["detail"]
    assert client.post(f"{REQUESTS}/{request['id']}/reject", json={"comment": "No"}, headers=world["admin_a"]).status_code == 403
    # Another cooperative's admin can't even see it.
    assert client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["admin_b"]).status_code == 404
    rejected = client.post(f"{REQUESTS}/{request['id']}/reject", json={"comment": "The slip shows 50 KG"}, headers=world["manager_a"])
    assert rejected.status_code == 200 and rejected.json()["status"] == "REJECTED"
    assert client.get(f"{BATCHES}/{batch['id']}", headers=world["admin_a"]).json()["status"] == "CONFIRMED"


def test_correction_proposal_is_validated_up_front(client, world):
    batch = confirm(client, world["admin_a"], batch_body(world, [(world["jane"], 50)], captured=50))
    over = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 60)], 50), headers=world["manager_a"])
    assert over.status_code == 422
    foreign = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["bob_b"], 10)], 50), headers=world["manager_a"])
    assert foreign.status_code == 422
    same = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 50)], 50), headers=world["manager_a"])
    assert same.status_code == 422


def test_reversal_needs_an_admin_who_did_not_request_it(client, session, world):
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 30)], captured=30))
    request = client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Recorded twice by mistake"}, headers=world["manager_a"]).json()
    assert request["request_type"] == "REVERSAL"
    # Managers may request but not approve reversals.
    assert client.post(f"{REQUESTS}/{request['id']}/approve", json={}, headers=world["manager_a"]).status_code == 403
    ok = client.post(f"{REQUESTS}/{request['id']}/approve", json={"comment": "Confirmed duplicate"}, headers=world["admin_a"])
    assert ok.status_code == 200
    reversed_batch = client.get(f"{BATCHES}/{batch['id']}", headers=world["admin_a"]).json()
    assert reversed_batch["status"] == "REVERSED" and reversed_batch["lines"][0]["record_status"] == "REVERSED"
    assert session.query(CollectionBatch).count() == 1  # nothing deleted
    assert client.get(COLL, headers=world["admin_a"]).json()["summary"]["accepted_kg"] == 0
    # A reversed collection can't be changed again.
    again = client.post(f"{BATCHES}/{batch['id']}/corrections", json=correction_body(world, [(world["jane"], 10)], 30), headers=world["manager_a"])
    assert again.status_code == 409


def test_requester_can_withdraw(client, world):
    batch = confirm(client, world["col_a"], batch_body(world, [(world["jane"], 30)], captured=30))
    request = client.post(f"{BATCHES}/{batch['id']}/reversals", json={"reason": "Wrong farmer chosen"}, headers=world["col_a"]).json()
    assert client.post(f"{REQUESTS}/{request['id']}/cancel", headers=world["manager_a"]).status_code == 403
    assert client.post(f"{REQUESTS}/{request['id']}/cancel", headers=world["col_a"]).json()["status"] == "CANCELLED"
    assert client.get(f"{BATCHES}/{batch['id']}", headers=world["col_a"]).json()["status"] == "CONFIRMED"
    # The collector sees only their own requests.
    assert client.get(REQUESTS, headers=world["col2_a"]).json()["total"] == 0
    assert client.get(REQUESTS, headers=world["col_a"]).json()["total"] == 1


def test_legacy_litres_entry_becomes_a_one_line_batch(client, session, world):
    res = client.post(COLL, json={"farmer_id": world["jane"]["id"], "quantity_litres": 10}, headers=world["admin_a"])
    assert res.status_code == 201
    line = res.json()
    assert line["quantity_litres"] == 10 and line["quantity_kg"] == 10.3 and line["weight_source"] == "LITRES"
    batch = session.get(CollectionBatch, uuid.UUID(line["batch_id"]))
    assert float(batch.captured_weight_kg) == 10.3 and batch.send_receipts is False


def test_batch_date_cannot_be_in_the_future(client, world):
    future = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    res = client.post(BATCHES, json=batch_body(world, [(world["jane"], 1)], captured=1, collection_date=future), headers=world["admin_a"])
    assert res.status_code == 422


def test_a_collector_can_never_obtain_another_collectors_batch_by_id(client, world):
    body = {**batch_body(world, [(world["jane"], 10)], captured=10), "id": str(uuid.uuid4())}
    confirm(client, world["col_a"], body)
    res = client.post(BATCHES, json=body, headers=world["col2_a"])
    assert res.status_code == 409 and "already in use" in res.json()["detail"]
