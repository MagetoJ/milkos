"""Superadmin platform, permissions and tenant isolation.

The end-to-end test at the bottom walks the full flow: a cooperative admin sets up farmers, a collector
and a cooler, the collector records milk, and the superadmin sees exactly that data (no copies).
"""
import datetime
from uuid import UUID

import pytest

from models.admin import AuditLog, SMSCreditPayment
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.operations import Collector
from models.user import User
from schemas.auth import UserRole
from tests.conftest import SUPERADMIN_EMAIL
from tests.test_cooperative_module import PASSWORD, headers_for, make_coop, make_user

SA = "/api/v1/superadmin"
COOP = "/api/v1/cooperative"
COLL = "/api/v1/collections"


@pytest.fixture
def platform(client, session, superadmin_headers):
    """Two cooperatives (A, B) with staff, and the superadmin."""
    a, b = make_coop(session, 1), make_coop(session, 2)
    make_user(session, a, UserRole.COOP_ADMIN, "admin@a.coop", "+254700000011")
    make_user(session, a, UserRole.MANAGER, "manager@a.coop", "+254700000012")
    make_user(session, b, UserRole.COOP_ADMIN, "admin@b.coop", "+254700000021")
    return {
        "a": a, "b": b, "sa": superadmin_headers,
        "admin_a": headers_for(client, "admin@a.coop"),
        "manager_a": headers_for(client, "manager@a.coop"),
        "admin_b": headers_for(client, "admin@b.coop"),
    }


def new_farmer(client, headers, phone="0712345678", **extra):
    res = client.post(f"{COOP}/farmers", headers=headers, json={"first_name": "Jane", "last_name": "Wanjiku", "phone": phone, **extra})
    assert res.status_code == 201, res.text
    return res.json()


def new_collector(client, headers, email="col@a.coop", phone="0722000001", **extra):
    res = client.post(f"{COOP}/collectors", headers=headers, json={
        "full_name": "Peter Collector", "email": email, "phone": phone, "password": PASSWORD, **extra,
    })
    assert res.status_code == 201, res.text
    return res.json()


def new_cooler(client, headers, **extra):
    res = client.post(f"{COOP}/coolers", headers=headers, json={"name": "Limuru Tank", "capacity_litres": 2000, **extra})
    assert res.status_code == 201, res.text
    return res.json()


# ---------------- access to the superadmin API ----------------

ENDPOINTS = [
    "/dashboard", "/cooperatives", "/users", "/farmers", "/collectors", "/coolers", "/collections",
    "/payments", "/audit-logs", "/search?q=jane", "/settings", "/roles", "/reports/collections", "/stats",
]


@pytest.mark.parametrize("path", ENDPOINTS)
def test_superadmin_api_requires_login(client, path):
    assert client.get(SA + path).status_code == 401


def test_superadmin_api_is_closed_to_every_other_role(client, session, platform):
    make_user(session, platform["a"], UserRole.COLLECTOR, "c@a.coop", "+254700000013")
    make_user(session, platform["a"], UserRole.FARMER, "f@a.coop", "+254700000014")
    others = [platform["admin_a"], platform["manager_a"], headers_for(client, "c@a.coop"), headers_for(client, "f@a.coop")]
    for headers in others:
        for path in ENDPOINTS:
            assert client.get(SA + path, headers=headers).status_code == 403, path
        assert client.post(f"{SA}/cooperatives", headers=headers, json={}).status_code == 403


def test_deactivated_superadmin_is_cut_off_immediately(client, session, platform):
    root = session.query(User).filter_by(email=SUPERADMIN_EMAIL).one()
    root.is_active = False
    session.commit()
    assert client.get(f"{SA}/dashboard", headers=platform["sa"]).status_code == 401


# ---------------- cooperatives ----------------

COOP_BODY = {
    "name": "Limuru Dairy Cooperative", "registration_number": "cs/9999", "kra_pin": "p051234567z",
    "county": "kiambu", "location": "Limuru", "contact_phone": "0711000000",
    "admin": {"full_name": "Grace Admin", "email": "Grace@Limuru.coop", "phone": "0711000001", "password": PASSWORD},
}


def test_create_update_and_list_cooperatives(client, session, platform):
    res = client.post(f"{SA}/cooperatives", headers=platform["sa"], json=COOP_BODY)
    assert res.status_code == 201, res.text
    coop = res.json()
    assert coop["registration_number"] == "CS/9999" and coop["kra_pin"] == "P051234567Z" and coop["county"] == "Kiambu"
    assert coop["code"].startswith("LIMURU-") and coop["counts"]["admins"] == 1

    # The admin account works straight away and lands in the new cooperative.
    admin = headers_for(client, "grace@limuru.coop")
    assert client.get(f"{COOP}/overview", headers=admin).json()["cooperative"]["code"] == coop["code"]

    assert client.post(f"{SA}/cooperatives", headers=platform["sa"], json={**COOP_BODY, "admin": None}).status_code == 409

    res = client.put(f"{SA}/cooperatives/{coop['id']}", headers=platform["sa"], json={"location": "Tigoni"})
    assert res.status_code == 200 and res.json()["location"] == "Tigoni"

    page = client.get(f"{SA}/cooperatives?search=limuru+dairy", headers=platform["sa"]).json()
    assert page["total"] == 1 and page["items"][0]["id"] == coop["id"]
    assert client.get(f"{SA}/cooperatives?sort=-bogus", headers=platform["sa"]).status_code == 422

    actions = [a for (a,) in session.query(AuditLog.action).filter(AuditLog.cooperative_id == UUID(coop["id"]))]
    assert {"COOPERATIVE_CREATED", "USER_CREATED", "COOPERATIVE_UPDATED"} <= set(actions)
    update = session.query(AuditLog).filter_by(action="COOPERATIVE_UPDATED").one()
    assert update.old_values == {"location": "Limuru"} and update.new_values == {"location": "Tigoni"}
    assert update.actor_role == "SUPER_ADMIN" and update.actor_email == SUPERADMIN_EMAIL


def test_suspension_is_enforced_by_the_backend(client, session, platform):
    a = str(platform["a"].id)
    assert client.patch(f"{SA}/cooperatives/{a}/status", headers=platform["sa"], json={"status": "SUSPENDED"}).status_code == 422
    res = client.patch(f"{SA}/cooperatives/{a}/status", headers=platform["sa"], json={"status": "SUSPENDED", "reason": "Unpaid fees"})
    assert res.status_code == 200 and res.json()["status"] == "SUSPENDED"

    # Every workspace and operations endpoint now refuses the cooperative's users.
    for path in (f"{COOP}/overview", f"{COOP}/farmers", COLL):
        res = client.get(path, headers=platform["admin_a"])
        assert res.status_code == 403 and "suspended" in res.json()["detail"], path
    # Other cooperatives are unaffected.
    assert client.get(f"{COOP}/overview", headers=platform["admin_b"]).status_code == 200

    assert client.patch(f"{SA}/cooperatives/{a}/status", headers=platform["sa"], json={"status": "ACTIVE"}).status_code == 200
    assert client.get(f"{COOP}/overview", headers=platform["admin_a"]).status_code == 200
    actions = [a for (a,) in session.query(AuditLog.action).order_by(AuditLog.created_at)]
    assert actions[-2:] == ["COOPERATIVE_SUSPENDED", "COOPERATIVE_ACTIVATED"]


def test_sms_credit_adjustment_is_audited_and_cannot_go_negative(client, session, platform):
    a = str(platform["a"].id)
    res = client.post(f"{SA}/cooperatives/{a}/sms-credits", headers=platform["sa"], json={"delta": 500, "reason": "Welcome bonus"})
    assert res.status_code == 200 and res.json()["sms_credit_balance"] == 500
    res = client.post(f"{SA}/cooperatives/{a}/sms-credits", headers=platform["sa"], json={"delta": -600, "reason": "Correction"})
    assert res.status_code == 422
    entry = session.query(AuditLog).filter_by(action="SMS_CREDITS_ADJUSTED").one()
    assert entry.old_values == {"sms_credit_balance": 0}
    assert entry.new_values == {"sms_credit_balance": 500, "delta": 500, "reason": "Welcome bonus"}


# ---------------- payments ----------------

def test_payment_verification_credits_the_balance_once(client, session, platform):
    res = client.post(f"{COOP}/sms-credits/payments", headers=platform["admin_a"], json={
        "credits": 1000, "amount_kes": 800, "mpesa_reference": "sjk3h2l9qx",
    })
    assert res.status_code == 201, res.text
    payment = res.json()
    assert payment["masked_mpesa_ref"] == "SJK•••••QX" and payment["status"] == "PENDING"
    # The same M-Pesa code can't be claimed twice.
    again = client.post(f"{COOP}/sms-credits/payments", headers=platform["admin_a"], json={
        "credits": 1000, "amount_kes": 800, "mpesa_reference": "SJK3H2L9QX",
    })
    assert again.status_code == 409

    pending = client.get(f"{SA}/payments?status=PENDING", headers=platform["sa"]).json()
    assert pending["total"] == 1 and pending["items"][0]["cooperative_name"] == "Coop 1"
    assert "mpesa_reference" not in pending["items"][0]

    url = f"{SA}/payments/{payment['id']}/action"
    assert client.post(url, headers=platform["sa"], json={"action": "REJECT", "reason": "no"}).status_code == 422
    assert client.post(url, headers=platform["sa"], json={"action": "VERIFY"}).status_code == 200
    assert client.post(url, headers=platform["sa"], json={"action": "VERIFY"}).status_code == 409

    session.expire_all()
    assert session.get(Cooperative, platform["a"].id).sms_credit_balance == 1000
    assert session.query(SMSCreditPayment).one().status == "VERIFIED"
    entry = session.query(AuditLog).filter_by(action="PAYMENT_VERIFIED").one()
    assert entry.new_values["sms_credit_balance"] == 1000 and entry.cooperative_id == platform["a"].id
    detail = client.get(f"{SA}/payments/{payment['id']}", headers=platform["sa"]).json()
    assert [e["action"] for e in detail["activity"]] == ["PAYMENT_VERIFIED", "PAYMENT_SUBMITTED"]


# ---------------- users ----------------

def test_user_management_rules(client, session, platform):
    sa = platform["sa"]
    me = session.query(User).filter_by(email=SUPERADMIN_EMAIL).one()
    assert client.patch(f"{SA}/users/{me.id}/status", headers=sa, json={"is_active": False}).status_code == 403
    assert client.put(f"{SA}/users/{me.id}", headers=sa, json={"role": "MANAGER"}).status_code == 403

    # Non-platform roles must belong to a cooperative; platform accounts must not.
    body = {"full_name": "New Person", "email": "new@x.coop", "phone": "0733000001", "password": PASSWORD}
    assert client.post(f"{SA}/users", headers=sa, json={**body, "role": "MANAGER"}).status_code == 422
    assert client.post(f"{SA}/users", headers=sa, json={**body, "role": "SUPER_ADMIN", "cooperative_id": str(platform["a"].id)}).status_code == 422

    res = client.post(f"{SA}/users", headers=sa, json={**body, "role": "COLLECTOR", "cooperative_id": str(platform["a"].id)})
    assert res.status_code == 201, res.text
    user_id = res.json()["id"]
    assert session.query(Collector).filter_by(user_id=UUID(user_id)).one().collector_number == "COL-001"

    # Roles can't be silently escalated to (or from) superadmin.
    res = client.put(f"{SA}/users/{user_id}", headers=sa, json={"role": "SUPER_ADMIN"})
    assert res.status_code == 422
    # A collector's records stay with their cooperative.
    assert client.put(f"{SA}/users/{user_id}", headers=sa, json={"cooperative_id": str(platform["b"].id)}).status_code == 422

    res = client.put(f"{SA}/users/{user_id}", headers=sa, json={"role": "MANAGER"})
    assert res.status_code == 200 and res.json()["role"] == "MANAGER"
    assert session.query(Collector).filter_by(user_id=UUID(user_id)).one().status == "INACTIVE"
    assert session.query(AuditLog).filter_by(action="USER_ROLE_CHANGED").one().old_values == {"role": "COLLECTOR"}

    res = client.patch(f"{SA}/users/{user_id}/status", headers=sa, json={"is_active": False, "reason": "Left"})
    assert res.status_code == 200 and res.json()["is_active"] is False
    assert client.post("/api/v1/auth/login", json={"email": "new@x.coop", "password": PASSWORD}).status_code == 403

    page = client.get(f"{SA}/users?role=COOP_ADMIN&cooperative_id={platform['a'].id}", headers=sa).json()
    assert [u["email"] for u in page["items"]] == ["admin@a.coop"]


def test_disabling_another_superadmin_cuts_their_access(client, session, platform):
    make_user(session, None, UserRole.SUPER_ADMIN, "second@milkflow.co.ke", "+254700000099")
    second = headers_for(client, "second@milkflow.co.ke")
    assert client.get(f"{SA}/dashboard", headers=second).status_code == 200
    other_id = session.query(User).filter_by(email="second@milkflow.co.ke").one().id
    assert client.patch(f"{SA}/users/{other_id}/status", headers=platform["sa"], json={"is_active": False}).status_code == 200
    assert client.get(f"{SA}/dashboard", headers=second).status_code == 401


# ---------------- tenant isolation ----------------

def test_cooperative_admin_cannot_reach_another_cooperative(client, session, platform):
    a_admin, b = platform["admin_a"], str(platform["b"].id)
    b_farmer = new_farmer(client, platform["admin_b"], phone="0799000001")
    b_cooler = new_cooler(client, platform["admin_b"])

    # Naming another cooperative is refused outright...
    assert client.get(f"{COLL}?cooperative_id={b}", headers=a_admin).status_code == 403
    assert client.post(f"{COOP}/farmers", headers=a_admin, json={
        "first_name": "X", "last_name": "Y", "phone": "0712000999", "cooperative_id": b,
    }).status_code == 403
    assert client.post(f"{COOP}/coolers", headers=a_admin, json={"name": "Sneaky", "cooperative_id": b}).status_code == 403
    assert client.post(f"{COOP}/collectors", headers=a_admin, json={
        "full_name": "Sneaky Person", "email": "s@x.coop", "phone": "0712000998", "password": PASSWORD, "cooperative_id": b,
    }).status_code == 403
    assert client.post(COLL, headers=a_admin, json={"farmer_id": b_farmer["id"], "quantity_litres": 5, "cooperative_id": b}).status_code == 403
    # ...and another cooperative's rows look like they don't exist.
    assert client.patch(f"{COOP}/coolers/{b_cooler['id']}", headers=a_admin, json={"name": "Mine now"}).status_code == 404
    assert client.patch(f"{COOP}/farmers/{b_farmer['id']}", headers=a_admin, json={"village": "X"}).status_code == 404
    res = client.post(COLL, headers=a_admin, json={"farmer_id": b_farmer["id"], "quantity_litres": 5})
    assert res.status_code == 422 and res.json()["detail"][0]["loc"][-1] == "farmer_id"
    # Using A's own farmer with B's cooler doesn't work either.
    a_farmer = new_farmer(client, a_admin)
    res = client.post(COLL, headers=a_admin, json={"farmer_id": a_farmer["id"], "quantity_litres": 5, "cooler_id": b_cooler["id"]})
    assert res.status_code == 422 and res.json()["detail"][0]["loc"][-1] == "cooler_id"


def test_manager_permissions(client, session, platform):
    manager = platform["manager_a"]
    cooler = new_cooler(client, platform["admin_a"])
    assert client.post(f"{COOP}/coolers", headers=manager, json={"name": "Tank 2"}).status_code == 403
    assert client.patch(f"{COOP}/coolers/{cooler['id']}", headers=manager, json={"is_operational": False}).status_code == 200
    assert client.patch(f"{COOP}/coolers/{cooler['id']}", headers=manager, json={"status": "INACTIVE"}).status_code == 403
    assert client.post(f"{COOP}/collectors", headers=manager, json={
        "full_name": "Nope Person", "email": "n@a.coop", "phone": "0712000997", "password": PASSWORD,
    }).status_code == 403
    assert client.get(f"{COOP}/activity", headers=manager).status_code == 403
    assert client.get(f"{COOP}/activity", headers=platform["admin_a"]).status_code == 200


def test_collectors_and_farmers_only_see_their_own_records(client, session, platform):
    admin = platform["admin_a"]
    jane = new_farmer(client, admin, phone="0712000001")
    john = new_farmer(client, admin, phone="0712000002", first_name="John")
    new_collector(client, admin, email="c1@a.coop", phone="0722000001")
    new_collector(client, admin, email="c2@a.coop", phone="0722000002")
    c1, c2 = headers_for(client, "c1@a.coop"), headers_for(client, "c2@a.coop")

    assert client.post(COLL, headers=c1, json={"farmer_id": jane["id"], "quantity_litres": 10}).status_code == 201
    assert client.post(COLL, headers=c2, json={"farmer_id": john["id"], "quantity_litres": 7}).status_code == 201
    other = session.query(Collector).join(User, User.id == Collector.user_id).filter(User.email == "c2@a.coop").one()
    # A collector can't record under someone else's name.
    assert client.post(COLL, headers=c1, json={"farmer_id": jane["id"], "quantity_litres": 1, "collector_id": str(other.id)}).status_code == 403
    # Collectors can't correct records.
    mine = client.get(COLL, headers=c1).json()
    assert mine["total"] == 1 and mine["items"][0]["farmer_name"] == "Jane Wanjiku"
    assert client.patch(f"{COLL}/{mine['items'][0]['id']}", headers=c1, json={"quantity_litres": 50}).status_code == 403
    theirs = client.get(COLL, headers=c2).json()["items"][0]["id"]
    assert client.get(f"{COLL}/{theirs}", headers=c1).status_code == 404

    # Jane gets an account linked to her farmer record and sees only her own milk.
    res = client.post(f"{SA}/users", headers=platform["sa"], json={
        "full_name": "Jane Wanjiku", "email": "jane@farm.ke", "phone": "0712999000", "password": PASSWORD,
        "role": "FARMER", "cooperative_id": str(platform["a"].id), "farmer_id": jane["id"],
    })
    assert res.status_code == 201, res.text
    jane_headers = headers_for(client, "jane@farm.ke")
    seen = client.get(COLL, headers=jane_headers).json()
    assert seen["total"] == 1 and seen["items"][0]["quantity_litres"] == 10 and seen["can_record"] is False
    assert client.post(COLL, headers=jane_headers, json={"farmer_id": jane["id"], "quantity_litres": 1}).status_code == 403
    assert client.get(f"{COLL}/{theirs}", headers=jane_headers).status_code == 404
    assert client.get(f"{COOP}/farmers", headers=jane_headers).status_code == 403

    # Staff see both.
    assert client.get(COLL, headers=admin).json()["total"] == 2


def test_quality_thresholds_from_settings(client, session, platform):
    admin = platform["admin_a"]
    farmer = new_farmer(client, admin)
    res = client.put(f"{SA}/settings", headers=platform["sa"], json={"values": {"collection.max_temperature_c": 8}})
    assert res.status_code == 200
    warm = client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 20, "temperature_c": 12})
    assert warm.json()["quality_status"] == "REJECTED" and "above" in warm.json()["rejection_reason"]
    cold = client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 20, "temperature_c": 4})
    assert cold.json()["quality_status"] == "ACCEPTED"
    # A manual rejection needs a reason.
    res = client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 2, "quality_status": "REJECTED"})
    assert res.status_code == 422

    assert client.put(f"{SA}/settings", headers=platform["sa"], json={"values": {"nope": 1}}).status_code == 422
    assert client.put(f"{SA}/settings", headers=platform["sa"], json={"values": {"collection.max_temperature_c": 99}}).status_code == 422
    assert session.query(AuditLog).filter_by(action="SETTINGS_UPDATED").one().new_values == {"collection.max_temperature_c": 8.0}


def test_closing_onboarding_closes_registration(client, platform):
    client.put(f"{SA}/settings", headers=platform["sa"], json={"values": {"onboarding.accepting_applications": False}})
    res = client.post("/api/v1/auth/register", json={
        "cooperative_name": "Closed Co-op", "registration_number": "CS/77", "kra_pin": "P000000077A",
        "county": "Nakuru", "location": "Njoro", "admin_full_name": "Ann Admin",
        "admin_email": "ann@example.com", "admin_phone": "0700111222", "admin_id_number": "1234567",
        "password": "Passw0rdX",
    })
    assert res.status_code == 503


def test_me_reports_permissions(client, platform):
    me = client.get("/api/v1/auth/me", headers=platform["manager_a"]).json()
    assert me["role"] == "MANAGER" and "farmer.create" in me["permissions"] and "user.create" not in me["permissions"]
    assert me["cooperative_id"] == str(platform["a"].id)


# ---------------- the whole flow, both directions ----------------

def test_cooperative_operations_are_visible_to_the_superadmin(client, session, platform):
    admin, sa = platform["admin_a"], platform["sa"]

    farmer = new_farmer(client, admin, number_of_cows=4, payment_method="MPESA")
    assert farmer["payment_account"] == "+254712345678"  # defaults to the farmer's phone
    cooler = new_cooler(client, admin, scale_device_id="SCALE-77")
    assert cooler["code"] == "CLR-001"
    collector = new_collector(client, admin, assigned_area="Tigoni ridge", cooler_id=cooler["id"])
    assert collector["collector_number"] == "COL-001" and collector["cooler_name"] == "Limuru Tank"

    col_headers = headers_for(client, "col@a.coop")
    options = client.get(f"{COLL}/options", headers=col_headers).json()
    assert options["default_cooler_id"] == cooler["id"] and options["farmers"][0]["id"] == farmer["id"]
    res = client.post(COLL, headers=col_headers, json={
        "farmer_id": farmer["id"], "quantity_litres": 23.5, "fat_percentage": 4.1, "snf_percentage": 8.6, "temperature_c": 4,
    })
    assert res.status_code == 201, res.text
    recorded = res.json()
    # The collector's assigned cooler is used when none is named.
    assert recorded["cooler_id"] == cooler["id"] and recorded["collector_name"] == "Peter Collector"
    assert recorded["reference"].startswith("MC-")

    # --- the superadmin sees the same records ---
    dash = client.get(f"{SA}/dashboard", headers=sa).json()
    assert dash["milk"]["today"] == 23.5 and dash["milk"]["collections_today"] == 1
    assert dash["farmers"]["total"] == 1 and dash["collectors"]["total"] == 1 and dash["coolers"]["operational"] == 1
    assert dash["cooperatives"] == {"total": 2, "active": 2, "suspended": 0}
    assert dash["milk"]["daily"][-1]["litres"] == 23.5

    a = str(platform["a"].id)
    detail = client.get(f"{SA}/cooperatives/{a}", headers=sa).json()
    assert detail["counts"]["farmers"] == 1 and detail["counts"]["collectors"] == 1 and detail["counts"]["coolers"] == 1
    assert detail["counts"]["managers"] == 1 and detail["milk"]["today"] == 23.5
    assert [x["email"] for x in detail["administrators"]] == ["admin@a.coop"]

    collections = client.get(f"{SA}/collections?cooperative_id={a}", headers=sa).json()
    assert collections["total"] == 1 and collections["items"][0]["id"] == recorded["id"]
    assert collections["summary"]["accepted_litres"] == 23.5
    assert client.get(f"{SA}/collections?cooperative_id={platform['b'].id}", headers=sa).json()["total"] == 0
    assert client.get(f"{SA}/collections?search={recorded['reference']}", headers=sa).json()["total"] == 1

    farmers = client.get(f"{SA}/farmers?cooperative_id={a}", headers=sa).json()
    assert farmers["items"][0]["stats"]["total_litres"] == 23.5 and farmers["items"][0]["cooperative_name"] == "Coop 1"
    farmer_detail = client.get(f"{SA}/farmers/{farmer['id']}", headers=sa).json()
    assert farmer_detail["recent_collections"][0]["reference"] == recorded["reference"]
    assert farmer_detail["activity"][0]["action"] == "FARMER_CREATED"

    collectors = client.get(f"{SA}/collectors?cooperative_id={a}", headers=sa).json()
    assert collectors["items"][0]["stats"]["total_litres"] == 23.5
    coolers = client.get(f"{SA}/coolers?cooperative_id={a}", headers=sa).json()
    assert coolers["items"][0]["litres_today"] == 23.5

    report = client.get(f"{SA}/reports/collections", headers=sa).json()
    assert report["totals"]["accepted_litres"] == 23.5 and report["by_cooperative"][0]["name"] == "Coop 1"
    assert report["top_farmers"][0]["full_name"] == "Jane Wanjiku"

    hits = client.get(f"{SA}/search?q=jane", headers=sa).json()["results"]
    assert {"type": "FARMER", "title": "Jane Wanjiku", "subtitle": "F-0001", "context": "Coop 1"}.items() <= hits[0].items()
    types = {r["type"] for r in client.get(f"{SA}/search?q=limuru", headers=sa).json()["results"]}
    assert "COOLER" in types

    log = client.get(f"{SA}/audit-logs?cooperative_id={a}", headers=sa).json()
    actions = [e["action"] for e in log["items"]]
    assert {"FARMER_CREATED", "COOLER_CREATED", "COLLECTOR_CREATED", "COLLECTION_RECORDED"} <= set(actions)
    by_collector = [e for e in log["items"] if e["action"] == "COLLECTION_RECORDED"][0]
    assert by_collector["actor_role"] == "COLLECTOR" and by_collector["actor_email"] == "col@a.coop"
    assert client.get(f"{SA}/audit-logs?action=FARMER_CREATED", headers=sa).json()["total"] == 1

    # No duplicates: one farmer row, one collection row, whoever looks.
    assert session.query(Farmer).count() == 1

    # --- a superadmin correction is visible to the cooperative and audited ---
    res = client.put(f"{SA}/farmers/{farmer['id']}", headers=sa, json={"number_of_cows": 6})
    assert res.status_code == 200
    seen = client.get(f"{COOP}/farmers", headers=admin).json()["items"][0]
    assert seen["number_of_cows"] == 6
    entry = session.query(AuditLog).filter_by(action="FARMER_UPDATED").one()
    assert entry.old_values == {"number_of_cows": 4} and entry.actor_role == "SUPER_ADMIN"

    # Deactivating the collector stops them recording (and signing in).
    res = client.patch(f"{SA}/collectors/{collector['id']}/status", headers=sa, json={"status": "INACTIVE"})
    assert res.status_code == 200 and res.json()["account_active"] is False
    assert client.post(COLL, headers=col_headers, json={"farmer_id": farmer["id"], "quantity_litres": 1}).status_code == 401


def test_collection_date_filters_and_validation(client, platform):
    admin = platform["admin_a"]
    farmer = new_farmer(client, admin)
    yesterday = (datetime.datetime.utcnow().date() - datetime.timedelta(days=1)).isoformat()
    client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 5, "collection_date": yesterday})
    client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 7})
    future = (datetime.datetime.utcnow().date() + datetime.timedelta(days=5)).isoformat()
    assert client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 7, "collection_date": future}).status_code == 422
    assert client.post(COLL, headers=admin, json={"farmer_id": farmer["id"], "quantity_litres": 0}).status_code == 422

    page = client.get(f"{SA}/collections?date_to={yesterday}", headers=platform["sa"]).json()
    assert page["total"] == 1 and page["items"][0]["quantity_litres"] == 5
    assert client.get(f"{SA}/collections?min_litres=6", headers=platform["sa"]).json()["total"] == 1
    assert client.get(f"{SA}/reports/collections?date_from=2026-01-10&date_to=2026-01-01", headers=platform["sa"]).status_code == 422
