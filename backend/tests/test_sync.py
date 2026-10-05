"""Offline sync: devices and offline sessions, push (idempotency, conflicts, tenant isolation), pull
(incremental, scoped), cooler readings, alerts and SMS notifications."""
import datetime
import uuid

import pytest

from models.admin import AuditLog, Cooler
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.notifications import Notification
from models.operations import MilkCollection
from models.sensors import CoolerReading
from models.user import User
from schemas.auth import UserRole
from services import sms
from services.sms import SmsResult
from tests.test_cooperative_module import PASSWORD, headers_for, make_coop, make_user

SYNC = "/api/v1/sync"
DEV = "/api/v1/devices"
COOP = "/api/v1/cooperative"


class FakeSms:
    name = "fake"

    def __init__(self, accept=True):
        self.accept = accept
        self.sent: list[tuple[str, str]] = []

    def send_sms(self, to, message):
        self.sent.append((to, message))
        if self.accept:
            return SmsResult(True, provider_message_id=f"msg-{len(self.sent)}")
        return SmsResult(False, error="gateway down")


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SYNC_SETTLE_SECONDS", "0")
    sms.reset_provider()
    yield
    sms.reset_provider()


def register(client, headers, device=None):
    device = device or f"dev-{uuid.uuid4()}"
    res = client.post(f"{DEV}/register", json={"device_identifier": device, "platform": "test"}, headers=headers)
    assert res.status_code == 200, res.text
    return device, res.json()["offline_session"]


def h(headers, device):
    return {**headers, "X-Device-Id": device}


def mutation(entity_type, payload, operation="create", local_id=None, **extra):
    return {
        "mutation_id": str(uuid.uuid4()), "entity_type": entity_type, "operation": operation,
        "local_id": str(local_id or uuid.uuid4()), "payload": payload,
        "client_timestamp": datetime.datetime.utcnow().isoformat() + "Z", **extra,
    }


def push(client, headers, device, *mutations):
    res = client.post(f"{SYNC}/push", json={"mutations": list(mutations)}, headers=h(headers, device))
    assert res.status_code == 200, res.text
    return res.json()["results"]


def pull_all(client, headers, device, cursor=0):
    changes = []
    while True:
        res = client.get(f"{SYNC}/pull", params={"cursor": cursor}, headers=h(headers, device))
        assert res.status_code == 200, res.text
        body = res.json()
        changes += body["changes"]
        cursor = body["cursor"]
        if not body["has_more"]:
            return changes, cursor


@pytest.fixture
def world(client, session):
    a, b = make_coop(session, 1), make_coop(session, 2)
    grant_credits(session, a, 10)
    make_user(session, a, UserRole.COOP_ADMIN, "admin@a.coop", "+254700000011")
    make_user(session, a, UserRole.MANAGER, "manager@a.coop", "+254700000012")
    make_user(session, b, UserRole.COOP_ADMIN, "admin@b.coop", "+254700000021")
    w = {"a": a, "b": b, "admin_a": headers_for(client, "admin@a.coop"), "admin_b": headers_for(client, "admin@b.coop"),
         "manager_a": headers_for(client, "manager@a.coop")}
    w["dev_a"], _ = register(client, w["admin_a"])
    w["dev_b"], _ = register(client, w["admin_b"])
    return w


def grant_credits(session, coop, credits, reference="test-grant"):
    """SMS credits through the ledger (the balance column is only a cache of it)."""
    from services import sms_credits

    sms_credits.adjust(session, coop.id, credits, "Test credits", None, reference)
    session.commit()


def farmer_payload(**overrides):
    data = {"first_name": "Jane", "last_name": "Wanjiku", "phone": "0712 345 678"}
    data.update(overrides)
    return data


def make_cooler(client, headers, **extra):
    body = {"name": "Kiserian Main Cooler", "capacity_litres": 5000, **extra}
    res = client.post(f"{COOP}/coolers", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ---------------- devices & offline sessions ----------------

def test_sync_requires_login_registered_device_and_staff_role(client, session, world):
    assert client.get(f"{SYNC}/pull").status_code == 401
    assert client.get(f"{SYNC}/pull", headers=world["admin_a"]).status_code == 400  # no X-Device-Id
    assert client.get(f"{SYNC}/pull", headers=h(world["admin_a"], "never-registered-1")).status_code == 403
    # Device B is registered for cooperative B: cooperative A can't use it.
    assert client.get(f"{SYNC}/pull", headers=h(world["admin_a"], world["dev_b"])).status_code == 403
    # The manager has no session on the admin's device yet.
    assert client.get(f"{SYNC}/pull", headers=h(world["manager_a"], world["dev_a"])).status_code == 403
    register(client, world["manager_a"], world["dev_a"])
    assert client.get(f"{SYNC}/pull", headers=h(world["manager_a"], world["dev_a"])).status_code == 200

    make_user(session, world["a"], UserRole.FARMER, "farmer@a.coop", "+254700000013")
    farmer_h = headers_for(client, "farmer@a.coop")
    res = client.get(f"{SYNC}/pull", headers=h(farmer_h, world["dev_a"]))
    assert res.status_code == 403


def test_device_bound_to_one_cooperative(client, world):
    res = client.post(f"{DEV}/register", json={"device_identifier": world["dev_a"]}, headers=world["admin_b"])
    assert res.status_code == 409 and "another cooperative" in res.json()["detail"]


def test_offline_session_refresh_rotation_and_revocation(client, session, world):
    device, offline = register(client, world["manager_a"])
    assert offline["user"]["role"] == "MANAGER" and offline["user"]["cooperative_id"] == str(world["a"].id)
    assert "farmer.create" in offline["permissions"]
    token = offline["token"]

    res = client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": token})
    assert res.status_code == 200, res.text
    body = res.json()
    new_token = body["offline_session"]["token"]
    assert new_token != token and body["role"] == "MANAGER"
    # The new access token works.
    client.cookies.clear()
    assert client.get(f"{COOP}/overview", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code == 200
    # The replaced secret still works briefly (lost-response grace), a made-up one never does.
    client.cookies.clear()
    assert client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": token}).status_code == 200
    client.cookies.clear()
    assert client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": "x" * 40}).status_code == 401

    # A deactivated account can't refresh.
    latest = client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": new_token})
    client.cookies.clear()
    current = latest.json()["offline_session"]["token"]
    user = session.query(User).filter_by(email="manager@a.coop").one()
    user.is_active = False
    session.commit()
    assert client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": current}).status_code == 401
    user.is_active = True
    session.commit()

    # Revoked on sign-out.
    assert client.post(f"{DEV}/session/revoke", json={"device_identifier": device, "session_token": current}).json()["revoked"]
    assert client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": current}).status_code == 401


def test_suspended_cooperative_and_deactivated_device(client, session, world):
    device, offline = register(client, world["manager_a"])
    # The admin deactivates the device: it can no longer sync or refresh.
    dev_id = offline["device"]["id"]
    res = client.patch(f"{COOP}/devices/{dev_id}", json={"is_active": False}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["is_active"] is False
    assert client.get(f"{SYNC}/pull", headers=h(world["manager_a"], device)).status_code == 403
    client.cookies.clear()
    assert client.post(f"{DEV}/session/refresh", json={"device_identifier": device, "session_token": offline["token"]}).status_code in (401, 403)
    # Managers can't deactivate devices.
    assert client.patch(f"{COOP}/devices/{dev_id}", json={"is_active": True}, headers=world["manager_a"]).status_code == 403


# ---------------- push: farmers ----------------

def test_offline_farmer_create_is_idempotent(client, session, world):
    local_id = uuid.uuid4()
    m = mutation("farmer", farmer_payload(), local_id=local_id)
    [first] = push(client, world["admin_a"], world["dev_a"], m)
    assert first["status"] == "applied", first
    assert first["server_id"] == str(local_id) and first["entity"]["farmer_number"] == "F-0001"
    assert first["entity"]["cooperative_id"] == str(world["a"].id)

    # The same mutation again (lost response) and the same record under a new mutation id: no second farmer.
    [again] = push(client, world["admin_a"], world["dev_a"], m)
    assert again["status"] == "duplicate" and again["server_id"] == str(local_id)
    [renamed] = push(client, world["admin_a"], world["dev_a"], {**m, "mutation_id": str(uuid.uuid4())})
    assert renamed["status"] == "duplicate"
    assert session.query(Farmer).count() == 1

    entry = session.query(AuditLog).filter_by(action="FARMER_CREATED").one()
    assert entry.new_values["synced_from_device"] == world["dev_a"]
    assert session.query(AuditLog).filter_by(action="SYNC_BATCH_RECEIVED").count() == 1


def test_duplicate_phone_is_a_resolvable_conflict(client, world):
    client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_a"])
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("farmer", farmer_payload(first_name="Other")))
    assert res["status"] == "conflict"
    assert "phone" in res["error"]["fields"]
    status = client.get(f"{SYNC}/status", headers=h(world["admin_a"], world["dev_a"])).json()
    assert status["open_conflicts"] == 1

    resolved = client.post(f"{SYNC}/conflicts/resolve", json={"mutation_id": res["mutation_id"], "resolution": "discarded"},
                           headers=h(world["admin_a"], world["dev_a"]))
    assert resolved.status_code == 200
    assert client.get(f"{SYNC}/status", headers=h(world["admin_a"], world["dev_a"])).json()["open_conflicts"] == 0


def test_validation_errors_are_rejected_with_fields(client, world):
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("farmer", {"first_name": "", "last_name": "X", "phone": "123"}))
    assert res["status"] == "rejected" and res["error"]["code"] == "validation"
    assert {"phone", "first_name"} & set(res["error"]["fields"])


def test_payload_cannot_choose_another_cooperative(client, session, world):
    [res] = push(client, world["admin_a"], world["dev_a"],
                 mutation("farmer", farmer_payload(cooperative_id=str(world["b"].id))))
    assert res["status"] == "rejected" and res["error"]["code"] == "forbidden"
    assert session.query(Farmer).count() == 0


def test_cannot_update_or_reference_another_cooperatives_records(client, session, world):
    theirs = client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_b"]).json()
    [upd] = push(client, world["admin_a"], world["dev_a"],
                 mutation("farmer", {"first_name": "Hacked"}, operation="update", local_id=theirs["id"], base_version=1))
    assert upd["status"] == "rejected" and upd["error"]["code"] == "not_found"
    [col] = push(client, world["admin_a"], world["dev_a"],
                 mutation("collection", {"farmer_id": theirs["id"], "quantity_litres": 10}))
    assert col["status"] == "rejected"
    # Reusing another cooperative's farmer id as a "new" local id gets a fresh server id.
    [new] = push(client, world["admin_a"], world["dev_a"], mutation("farmer", farmer_payload(), local_id=theirs["id"]))
    assert new["status"] == "applied" and new["server_id"] != theirs["id"]
    assert session.get(Farmer, uuid.UUID(theirs["id"])).first_name == "Jane"


def test_farmer_update_conflict_rules(client, world):
    farmer = client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_a"]).json()
    base = {"village": farmer["village"], "status": farmer["status"], "first_name": farmer["first_name"]}
    version = farmer["sync_version"]
    # Meanwhile, online: the server deactivates the farmer and edits the village.
    client.patch(f"{COOP}/farmers/{farmer['id']}", json={"status": "INACTIVE", "village": "Ngong"}, headers=world["admin_a"])

    # Offline edit of an administrative field the server also changed: conflict, server copy returned.
    [res] = push(client, world["admin_a"], world["dev_a"], mutation(
        "farmer", {"status": "ACTIVE"}, operation="update", local_id=farmer["id"], base_version=version, base=base))
    assert res["status"] == "conflict" and "status" in res["error"]["fields"]
    assert res["entity"]["status"] == "INACTIVE"

    # Offline edit of a non-administrative field: the device's edit wins.
    [res] = push(client, world["admin_a"], world["dev_a"], mutation(
        "farmer", {"first_name": "Janet"}, operation="update", local_id=farmer["id"], base_version=version, base=base))
    assert res["status"] == "applied" and res["entity"]["first_name"] == "Janet"
    assert res["entity"]["status"] == "INACTIVE"  # untouched
    assert res["server_version"] > version


def test_collectors_cannot_create_farmers(client, session, world):
    make_user(session, world["a"], UserRole.COLLECTOR, "col@a.coop", "+254700000014")
    client.post(f"{COOP}/team", json={}, headers=world["admin_a"])  # no-op; profile below
    from services.collectors import ensure_profile

    ensure_profile(session, session.query(User).filter_by(email="col@a.coop").one())
    session.commit()
    col_h = headers_for(client, "col@a.coop")
    device, _ = register(client, col_h)
    [res] = push(client, col_h, device, mutation("farmer", farmer_payload()))
    assert res["status"] == "rejected" and res["error"]["code"] == "forbidden"


# ---------------- push: collections ----------------

def test_offline_collection_for_offline_farmer_in_one_batch(client, session, world):
    farmer_local = uuid.uuid4()
    cooler = make_cooler(client, world["admin_a"])
    collection_local = uuid.uuid4()
    results = push(
        client, world["admin_a"], world["dev_a"],
        mutation("farmer", farmer_payload(), local_id=farmer_local),
        mutation("collection", {
            "farmer_id": str(farmer_local), "cooler_id": cooler["id"], "quantity_litres": 12.5,
            "collection_date": datetime.date.today().isoformat(), "collection_time": "06:30:00",
        }, local_id=collection_local),
    )
    assert [r["status"] for r in results] == ["applied", "applied"], results
    row = session.get(MilkCollection, collection_local)
    assert row is not None and float(row.quantity_litres) == 12.5
    assert row.device_id is not None and row.client_recorded_at is not None
    assert row.cooperative_id == world["a"].id

    # Confirmed collections are never overwritten: an offline edit of the quantity is refused.
    entity = results[1]["entity"]
    assert entity["batch_id"] and entity["quantity_kg"] == 12.88 and entity["weight_source"] == "LITRES"
    [refused] = push(client, world["admin_a"], world["dev_a"], mutation(
        "collection", {"quantity_litres": 13}, operation="update", local_id=collection_local, base_version=entity["sync_version"]))
    assert refused["status"] == "rejected" and refused["error"]["code"] == "immutable"
    session.expire_all()
    assert float(session.get(MilkCollection, collection_local).quantity_litres) == 12.5


# ---------------- pull ----------------

def test_pull_is_incremental_and_scoped(client, world):
    client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_a"])
    client.post(f"{COOP}/farmers", json=farmer_payload(phone="0799000111", first_name="Other"), headers=world["admin_b"])
    client.post(f"{COOP}/centres", json={"name": "Kiserian Centre"}, headers=world["admin_a"])

    changes, cursor = pull_all(client, world["admin_a"], world["dev_a"])
    types = {c["entity_type"] for c in changes}
    assert {"farmer", "centre", "team_member", "cooperative"} <= types
    farmers = [c["data"] for c in changes if c["entity_type"] == "farmer"]
    assert [f["first_name"] for f in farmers] == ["Jane"]  # never cooperative B's
    coop_ids = {c["data"]["id"] for c in changes if c["entity_type"] == "cooperative"}
    assert coop_ids == {str(world["a"].id)}
    assert cursor > 0

    # Nothing new: empty page, same cursor.
    again, same = pull_all(client, world["admin_a"], world["dev_a"], cursor)
    assert again == [] and same == cursor

    # One change: only that entity comes back, once, with its current state.
    farmer_id = farmers[0]["id"]
    client.patch(f"{COOP}/farmers/{farmer_id}", json={"village": "Rongai"}, headers=world["admin_a"])
    client.patch(f"{COOP}/farmers/{farmer_id}", json={"village": "Ongata"}, headers=world["admin_a"])
    delta, newer = pull_all(client, world["admin_a"], world["dev_a"], cursor)
    assert [(c["entity_type"], c["data"]["village"]) for c in delta] == [("farmer", "Ongata")]
    assert newer > cursor


def test_pull_holds_cursor_behind_unsettled_changes(client, world, monkeypatch):
    _, cursor = pull_all(client, world["admin_a"], world["dev_a"])
    monkeypatch.setenv("SYNC_SETTLE_SECONDS", "3600")
    client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_a"])
    first = client.get(f"{SYNC}/pull", params={"cursor": cursor}, headers=h(world["admin_a"], world["dev_a"])).json()
    assert len(first["changes"]) == 1 and first["cursor"] == cursor  # sent, but re-sent next time
    second = client.get(f"{SYNC}/pull", params={"cursor": first["cursor"]}, headers=h(world["admin_a"], world["dev_a"])).json()
    assert len(second["changes"]) == 1


def test_collector_pull_is_reduced(client, session, world):
    from services.collectors import ensure_profile

    user = make_user(session, world["a"], UserRole.COLLECTOR, "col@a.coop", "+254700000014")
    ensure_profile(session, user)
    session.commit()
    client.post(f"{COOP}/farmers", json=farmer_payload(national_id="12345678"), headers=world["admin_a"])
    col_h = headers_for(client, "col@a.coop")
    device, _ = register(client, col_h)
    changes, _ = pull_all(client, col_h, device)
    types = {c["entity_type"] for c in changes}
    assert "team_member" not in types and "notification" not in types
    farmer = next(c["data"] for c in changes if c["entity_type"] == "farmer")
    assert "national_id" not in farmer and "payment_account" not in farmer


# ---------------- cooler readings & alerts ----------------

def reading(cooler_id, litres, **extra):
    return {"cooler_id": cooler_id, "volume_litres": litres, "measured_at": datetime.datetime.utcnow().isoformat() + "Z",
            "source": "MANUAL", **extra}


def test_cooler_reading_storage_duplicates_and_quality(client, session, world):
    cooler = make_cooler(client, world["admin_a"])
    payload = reading(cooler["id"], 2438, measurement_id="evt-1", temperature_celsius=4.1)
    [first] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", payload))
    assert first["status"] == "applied" and first["entity"]["quality"] == "VALID"
    # The sensor resends the same measurement (new local id, new mutation): collapses onto the first.
    [dup] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", payload))
    assert dup["status"] == "duplicate" and dup["server_id"] == first["server_id"]
    assert session.query(CoolerReading).count() == 1

    row = session.get(Cooler, uuid.UUID(cooler["id"]))
    session.refresh(row)
    assert float(row.current_volume_litres) == 2438 and float(row.last_temperature_c) == 4.1

    # Implausible: stored, flagged, and doesn't move the cooler's level.
    [odd] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 9000)))
    assert odd["status"] == "applied" and odd["entity"]["quality"] == "SUSPICIOUS"
    assert "above_capacity" in odd["entity"]["quality_flags"]
    session.refresh(row)
    assert float(row.current_volume_litres) == 2438

    # Impossible: refused.
    [neg] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], -5)))
    assert neg["status"] == "rejected" and "volume_litres" in neg["error"]["fields"]

    history = client.get(f"{COOP}/coolers/{cooler['id']}/readings", headers=world["admin_a"]).json()
    assert len(history) == 2


def test_cooler_reading_ownership(client, world):
    theirs = make_cooler(client, world["admin_b"])
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(theirs["id"], 100)))
    assert res["status"] == "rejected"
    sensor = client.post(f"{COOP}/sensors", json={
        "name": "Tank probe", "sensor_identifier": "SN-1", "sensor_type": "ULTRASONIC_LEVEL", "transport": "BLUETOOTH_LE",
    }, headers=world["admin_b"]).json()
    mine = make_cooler(client, world["admin_a"])
    [res] = push(client, world["admin_a"], world["dev_a"],
                 mutation("cooler_reading", reading(mine["id"], 100, sensor_id=sensor["id"], source="BLUETOOTH")))
    assert res["status"] == "rejected" and "sensor_id" in res["error"]["fields"]


def test_sensor_binding_and_unbound_sensor_reading_is_suspicious(client, session, world):
    cooler = make_cooler(client, world["admin_a"])
    other = make_cooler(client, world["admin_a"], name="Rongai Cooler")
    sensor = client.post(f"{COOP}/sensors", json={
        "name": "Tank probe", "sensor_identifier": "SN-1", "sensor_type": "ULTRASONIC_LEVEL", "transport": "BLUETOOTH_LE",
        "cooler_id": cooler["id"],
    }, headers=world["admin_a"]).json()
    assert sensor["cooler_id"] == cooler["id"]
    listed = client.get(f"{COOP}/coolers", headers=world["admin_a"]).json()
    assert next(c for c in listed if c["id"] == cooler["id"])["sensors"][0]["id"] == sensor["id"]

    [ok] = push(client, world["admin_a"], world["dev_a"],
                mutation("cooler_reading", reading(cooler["id"], 100, sensor_id=sensor["id"], source="BLUETOOTH")))
    assert ok["entity"]["quality"] == "VALID"
    [odd] = push(client, world["admin_a"], world["dev_a"],
                 mutation("cooler_reading", reading(other["id"], 100, sensor_id=sensor["id"], source="BLUETOOTH")))
    assert odd["entity"]["quality"] == "SUSPICIOUS" and "sensor_not_bound_to_cooler" in odd["entity"]["quality_flags"]

    client.patch(f"{COOP}/sensors/{sensor['id']}", json={"cooler_id": None}, headers=world["admin_a"])
    actions = {a for (a,) in session.query(AuditLog.action)}
    assert {"SENSOR_REGISTERED", "SENSOR_BOUND", "SENSOR_UNBOUND"} <= actions


def test_low_volume_alert_sends_sms_to_admins_and_manager(client, session, world):
    fake = FakeSms()
    sms.set_provider(fake)
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=2000, manager_user_id=str(manager.id))
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 1876)))
    assert res["status"] == "applied"

    sent = session.query(Notification).filter_by(type="LOW_VOLUME").all()
    assert {n.recipient_phone for n in sent} == {"+254700000011", "+254700000012"}
    assert all(n.status == "SENT" and n.provider_message_id for n in sent)
    to, message = fake.sent[0]
    assert "Kiserian Main Cooler" in message and "1,876 L" in message and "Manager: Manager Person" in message
    session.expire_all()
    assert session.get(Cooperative, world["a"].id).sms_credit_balance == 8
    assert session.query(AuditLog).filter_by(action="NOTIFICATION_SENT").count() == 2

    # The same alert isn't repeated within the cooldown.
    push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 1500)))
    assert session.query(Notification).filter_by(type="LOW_VOLUME").count() == 2


def test_sms_failure_never_loses_the_reading(client, session, world):
    sms.set_provider(FakeSms(accept=False))
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=2000)
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 100)))
    assert res["status"] == "applied"
    assert session.query(CoolerReading).count() == 1
    n = session.query(Notification).one()
    assert n.status == "FAILED" and n.error == "gateway down" and n.next_attempt_at is not None and n.attempts == 1
    session.expire_all()
    assert session.get(Cooperative, world["a"].id).sms_credit_balance == 10  # refunded

    # Manual retry once the provider works again.
    sms.set_provider(FakeSms())
    retried = client.post(f"{COOP}/notifications/{n.id}/retry", headers=world["admin_a"]).json()
    assert retried["status"] == "SENT"
    listed = client.get(f"{COOP}/notifications", headers=world["admin_a"]).json()
    assert listed["total"] == 1 and listed["items"][0]["status"] == "SENT"


def test_no_provider_or_no_credits_is_failed_not_sent(client, session, world):
    sms.set_provider(None)
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=2000)
    push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 100)))
    n = session.query(Notification).one()
    assert n.status == "PENDING_PROVIDER" and "not configured" in n.error

    from services import sms_credits

    sms_credits.adjust(session, world["a"].id, -10, "Drain for the test", None, "test-drain")
    session.commit()
    sms.set_provider(FakeSms())
    retried = client.post(f"{COOP}/notifications/{n.id}/retry", headers=world["admin_a"]).json()
    assert retried["status"] == "FAILED" and "SMS credits" in retried["error"]


def test_simulated_readings_never_send_sms(client, session, world):
    fake = FakeSms()
    sms.set_provider(fake)
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=2000)
    [res] = push(client, world["admin_a"], world["dev_a"],
                 mutation("cooler_reading", reading(cooler["id"], 100, source="SIMULATED")))
    assert res["entity"]["quality"] == "SIMULATED"
    assert {n.status for n in session.query(Notification)} == {"SKIPPED"}
    assert fake.sent == []


def test_sensor_disconnect_and_stale_reading_alerts(client, session, world):
    sms.set_provider(FakeSms())
    cooler = make_cooler(client, world["admin_a"], stale_after_minutes=30)
    sensor = client.post(f"{COOP}/sensors", json={
        "name": "Tank probe", "sensor_identifier": "SN-9", "sensor_type": "LOAD_CELL", "transport": "BLUETOOTH_LE",
        "cooler_id": cooler["id"],
    }, headers=world["admin_a"]).json()
    [res] = push(client, world["admin_a"], world["dev_a"], mutation("sensor_event", {
        "sensor_id": sensor["id"], "event": "DISCONNECTED", "occurred_at": datetime.datetime.utcnow().isoformat() + "Z"}))
    assert res["status"] == "applied"
    assert session.query(Notification).filter_by(type="SENSOR_DISCONNECTED").count() == 1

    old = (datetime.datetime.utcnow() - datetime.timedelta(hours=2)).isoformat() + "Z"
    push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 100, measured_at=old)))
    client.post(f"{COOP}/coolers/alerts/check", headers=world["admin_a"])
    assert session.query(Notification).filter_by(type="STALE_READING", status="SENT").count() == 1


# ---------------- superadmin ----------------

def test_superadmin_sees_synced_records_and_cannot_push(client, session, world, superadmin_headers):
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=2000)
    push(client, world["admin_a"], world["dev_a"], mutation("cooler_reading", reading(cooler["id"], 100)))

    readings = client.get("/api/v1/superadmin/cooler-readings", headers=superadmin_headers).json()
    assert readings["total"] == 1 and readings["items"][0]["cooperative_name"] == "Coop 1"
    notes = client.get("/api/v1/superadmin/notifications", headers=superadmin_headers).json()
    assert notes["total"] == 1
    health = client.get("/api/v1/superadmin/sync/health", headers=superadmin_headers).json()
    row = next(r for r in health["cooperatives"] if r["cooperative_id"] == str(world["a"].id))
    assert row["devices"] == 1 and row["readings_24h"] == 1 and row["applied_24h"] == 1
    devices = client.get("/api/v1/superadmin/sync/devices", headers=superadmin_headers).json()
    assert devices["total"] == 2
    assert client.get("/api/v1/superadmin/sync/health", headers=world["admin_a"]).status_code == 403

    device, _ = register(client, superadmin_headers)
    res = client.post(f"{SYNC}/push", json={"mutations": [mutation("farmer", farmer_payload())]},
                      headers=h(superadmin_headers, device))
    assert res.status_code == 403
    changes, _ = pull_all(client, superadmin_headers, device)
    assert {c["entity_type"] for c in changes} == {"cooperative"}
    assert len(changes) == 2


def test_superadmin_can_release_a_device(client, world, superadmin_headers):
    dev = client.get("/api/v1/superadmin/sync/devices", headers=superadmin_headers).json()["items"]
    target = next(d for d in dev if d["device_identifier"] == world["dev_a"])
    res = client.patch(f"/api/v1/superadmin/sync/devices/{target['id']}?release=true", json={}, headers=superadmin_headers)
    assert res.status_code == 200 and res.json()["cooperative_id"] is None
    # Now cooperative B may take it over.
    register(client, world["admin_b"], world["dev_a"])


# ---------------- the offline end-to-end scenario ----------------

def test_offline_day_end_to_end(client, session, world, superadmin_headers):
    """Login online -> initial sync -> offline: farmer search, collection, sensor reading queued ->
    reconnect -> push -> server validates, stores, alerts by SMS -> device pulls -> superadmin sees it."""
    fake = FakeSms()
    sms.set_provider(fake)
    farmer = client.post(f"{COOP}/farmers", json=farmer_payload(), headers=world["admin_a"]).json()
    cooler = make_cooler(client, world["admin_a"], low_volume_alert_litres=3000)

    # 1-2. Online login (fixture) and device provisioning, then the initial download.
    changes, cursor = pull_all(client, world["admin_a"], world["dev_a"])
    assert any(c["entity_type"] == "farmer" and c["data"]["id"] == farmer["id"] for c in changes)

    # 3-15 happen on the device (covered by the frontend tests). It queues two mutations offline:
    collection_id, reading_id = uuid.uuid4(), uuid.uuid4()
    queued = [
        mutation("collection", {"farmer_id": farmer["id"], "cooler_id": cooler["id"], "quantity_litres": 20,
                                "collection_date": datetime.date.today().isoformat(), "collection_time": "07:15:00"},
                 local_id=collection_id),
        mutation("cooler_reading", reading(cooler["id"], 2438, measurement_id="ble-77", source="MANUAL"), local_id=reading_id),
    ]

    # 16-21. Connection returns; the sync engine pushes. A flaky network makes it send twice.
    first = push(client, world["admin_a"], world["dev_a"], *queued)
    second = push(client, world["admin_a"], world["dev_a"], *queued)
    assert [r["status"] for r in first] == ["applied", "applied"]
    assert [r["status"] for r in second] == ["duplicate", "duplicate"]
    assert session.query(MilkCollection).count() == 1 and session.query(CoolerReading).count() == 1

    # 22-23. The reading is under the 3,000 L threshold: SMS sent to the cooperative admin.
    assert len(fake.sent) == 1 and "2,438 L" in fake.sent[0][1]

    # 24. The device pulls and receives the server versions (collection, reading, cooler level, notification).
    delta, _ = pull_all(client, world["admin_a"], world["dev_a"], cursor)
    got = {(c["entity_type"], c["entity_id"]) for c in delta}
    assert ("collection", str(collection_id)) in got and ("cooler_reading", str(reading_id)) in got
    cooler_state = next(c["data"] for c in delta if c["entity_type"] == "cooler")
    assert cooler_state["current_volume_litres"] == 2438

    # 25. Superadmin sees the same server records.
    collections = client.get("/api/v1/superadmin/collections", headers=superadmin_headers).json()
    assert collections["total"] == 1 and collections["items"][0]["id"] == str(collection_id)
    assert client.get("/api/v1/superadmin/cooler-readings", headers=superadmin_headers).json()["total"] == 1

    # 26. Audit history.
    actions = [a for (a,) in session.query(AuditLog.action)]
    assert "SYNC_BATCH_RECEIVED" in actions and "COLLECTION_RECORDED" in actions and "NOTIFICATION_SENT" in actions
    recorded = session.query(AuditLog).filter_by(action="COLLECTION_RECORDED").one()
    assert recorded.new_values["synced_from_device"] == world["dev_a"]
