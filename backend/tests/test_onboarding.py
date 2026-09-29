import uuid

import pytest

from models.admin import CooperativeApplication
from models.cooperative import Cooperative
from models.user import User
from schemas.auth import UserRole
from tests.conftest import login

REGISTER = "/api/v1/auth/register"
PENDING = "/api/v1/superadmin/applications/pending"
PASSWORD = "Dairy#2026x"


def application(**overrides) -> dict:
    data = {
        "cooperative_name": "Limuru Dairy Farmers Co-operative Society",
        "registration_number": "CS/12345",
        "kra_pin": "P051234567Z",
        "county": "Kiambu",
        "location": "Limuru Town",
        "admin_full_name": "Jane Wanjiku",
        "admin_email": "jane@limurudairy.co.ke",
        "admin_phone": "0712345678",
        "admin_id_number": "28491029",
        "password": PASSWORD,
        "estimated_daily_liters": 4500,
        "initial_coolers_count": 3,
        "additional_info": "Founded 1998.",
    }
    data.update(overrides)
    return data


def decide(client, headers, app_id, action, reason=None):
    body = {"action": action}
    if reason:
        body["reason"] = reason
    return client.post(f"/api/v1/superadmin/applications/{app_id}/action", json=body, headers=headers)


def error_fields(res) -> list[str]:
    return [d["loc"][-1] for d in res.json()["detail"]]


# 1 ---------------------------------------------------------------------------

def test_register_then_approve_lets_the_admin_log_in(client, session, superadmin_headers):
    res = client.post(REGISTER, json=application())
    assert res.status_code == 201, res.text
    app_id = res.json()["application_id"]

    blocked = login(client, "jane@limurudairy.co.ke", PASSWORD)
    assert blocked.status_code == 403
    assert "pending approval" in blocked.json()["detail"]

    res = decide(client, superadmin_headers, app_id, "APPROVE")
    assert res.status_code == 200, res.text
    coop_id = res.json()["cooperative_id"]
    assert coop_id

    ok = login(client, "jane@limurudairy.co.ke", PASSWORD)
    assert ok.status_code == 200, ok.text
    assert ok.json()["role"] == "COOP_ADMIN"

    user = session.query(User).filter_by(email="jane@limurudairy.co.ke").one()
    assert user.is_active and str(user.cooperative_id) == coop_id
    assert user.phone_number == "+254712345678"

    coop = session.get(Cooperative, user.cooperative_id)
    assert coop.registration_number == "CS/12345" and coop.kra_pin == "P051234567Z"
    assert coop.county == "Kiambu" and coop.location == "Limuru Town"
    assert coop.status == "ACTIVE" and coop.sms_credit_balance == 0
    assert float(coop.estimated_daily_liters) == 4500
    assert coop.code.startswith("LIMURU-")

    record = session.get(CooperativeApplication, uuid.UUID(app_id))
    assert record.status == "APPROVED" and str(record.cooperative_id) == coop_id
    assert record.admin_user_id == user.id and record.reviewed_by and record.reviewed_at

    activity = client.get("/api/v1/superadmin/activity", headers=superadmin_headers).json()
    assert activity[0]["action"] == "APPLICATION_APPROVED"


# 2 ---------------------------------------------------------------------------

@pytest.mark.parametrize("duplicate", [
    {"registration_number": "cs/12345"},          # same number, different case
    {"kra_pin": "p051234567z"},                   # same PIN, lowercase
])
def test_duplicate_registration_number_or_kra_pin_is_409_while_pending(client, duplicate):
    assert client.post(REGISTER, json=application()).status_code == 201
    other_person = dict(
        cooperative_name="Another Co-op", admin_email="other@example.com", admin_phone="0799000111",
        admin_id_number="12345678", registration_number="CS/99999", kra_pin="A123456789B",
    )
    other_person.update(duplicate)
    res = client.post(REGISTER, json=application(**other_person))
    assert res.status_code == 409, res.text
    assert error_fields(res) == [next(iter(duplicate))]


@pytest.mark.parametrize("field", ["registration_number", "kra_pin"])
def test_duplicate_of_registered_cooperative_is_409(client, superadmin_headers, field):
    app_id = client.post(REGISTER, json=application()).json()["application_id"]
    assert decide(client, superadmin_headers, app_id, "APPROVE").status_code == 200

    fresh = dict(
        cooperative_name="Different Name", admin_email="new@example.com", admin_phone="0799000111",
        admin_id_number="12345678", registration_number="CS/99999", kra_pin="A123456789B",
    )
    fresh[field] = application()[field]
    res = client.post(REGISTER, json=application(**fresh))
    assert res.status_code == 409
    assert error_fields(res) == [field]
    assert "registered cooperative" in res.json()["detail"][0]["msg"]


@pytest.mark.parametrize("phone", ["+254712345678", "254 712 345 678", "712345678", "0712-345-678"])
def test_same_phone_written_differently_is_409(client, phone):
    assert client.post(REGISTER, json=application()).status_code == 201
    res = client.post(REGISTER, json=application(
        admin_phone=phone, admin_email="someone@else.com",
        registration_number="CS/2", kra_pin="A000000001Z", cooperative_name="Other Group",
    ))
    assert res.status_code == 409, res.text
    assert error_fields(res) == ["admin_phone"]
    assert "awaiting review" in res.json()["detail"][0]["msg"]


def test_duplicate_email_of_active_user_is_409(client, superadmin_headers):
    res = client.post(REGISTER, json=application(
        admin_email="ROOT@milkflow.co.ke", admin_phone="0722000000"
    ))
    assert res.status_code == 409
    assert error_fields(res) == ["admin_email"]
    assert "Sign in" in res.json()["detail"][0]["msg"]


def test_phone_of_farmer_is_409_with_specific_message(client, session):
    session.add(User(email="farmer@x.com", password_hash="x", full_name="F", phone_number="+254711111111",
                     role=UserRole.FARMER, is_active=True))
    session.commit()
    res = client.post(REGISTER, json=application(admin_phone="0711111111"))
    assert res.status_code == 409
    assert error_fields(res) == ["admin_phone"]
    assert "farmer account" in res.json()["detail"][0]["msg"]


def test_database_constraint_catches_a_race(client, monkeypatch):
    """If two requests pass the checks at the same time, the unique index still stops the second."""
    import routers.auth

    assert client.post(REGISTER, json=application()).status_code == 201
    monkeypatch.setattr(routers.auth, "find_conflict", lambda db, payload: None)
    res = client.post(REGISTER, json=application(
        admin_email="racer@example.com", admin_phone="0799111222", cooperative_name="Racer"
    ))
    assert res.status_code == 409
    assert "Traceback" not in res.text and "IntegrityError" not in res.text


# 3 ---------------------------------------------------------------------------

@pytest.mark.parametrize("field,value", [
    ("admin_phone", "0812345678"),
    ("admin_phone", "+1 202 555 0100"),
    ("admin_phone", "07123"),
    ("kra_pin", "X051234567Z"),
    ("kra_pin", "P05123456Z"),
    ("admin_id_number", "123456"),
    ("admin_id_number", "12345678a"),
    ("county", "Atlantis"),
    ("registration_number", "#"),
])
def test_invalid_values_are_422_naming_the_field(client, field, value):
    res = client.post(REGISTER, json=application(**{field: value}))
    assert res.status_code == 422, res.text
    assert error_fields(res) == [field]
    assert not res.json()["detail"][0]["msg"].startswith("Value error")


def test_values_are_normalised_before_saving(client, session):
    res = client.post(REGISTER, json=application(
        cooperative_name="  Limuru   Dairy  ", admin_email="  Jane@LimuruDairy.CO.KE ",
        kra_pin=" p051234567z ", county="kiambu county", admin_phone="254712345678",
        registration_number=" cs/12345 ", location=" Limuru ",
    ))
    assert res.status_code == 201, res.text
    rec = session.query(CooperativeApplication).one()
    assert rec.org_name == "Limuru Dairy"
    assert rec.email == "jane@limurudairy.co.ke"
    assert rec.kra_pin == "P051234567Z" and rec.registration_number == "CS/12345"
    assert rec.county == "Kiambu" and rec.sub_county == "Limuru" and rec.location == "Limuru, Kiambu"
    assert rec.phone == "+254712345678"
    assert rec.admin_id_number == "28491029" and rec.initial_coolers_count == 3
    assert rec.additional_info == "Founded 1998."
    user = session.query(User).one()
    assert user.email == "jane@limurudairy.co.ke" and not user.is_active
    assert rec.admin_user_id == user.id


# 4 ---------------------------------------------------------------------------

def test_similar_name_is_flagged_and_visible_to_superadmin(client, superadmin_headers):
    first = client.post(REGISTER, json=application()).json()["application_id"]
    second = client.post(REGISTER, json=application(
        cooperative_name="LIMURU DAIRY FARMERS COOPERATIVE SOCIETY LTD.",
        admin_email="b@example.com", admin_phone="0733000000",
        registration_number="CS/2", kra_pin="A000000001Z", admin_id_number="11112222",
    ))
    assert second.status_code == 201, second.text

    pending = client.get(PENDING, headers=superadmin_headers).json()
    by_id = {a["id"]: a for a in pending}
    assert by_id[first]["flags"] == []
    flags = by_id[second.json()["application_id"]]["flags"]
    assert [f["code"] for f in flags] == ["SIMILAR_NAME"]
    assert "Limuru Dairy Farmers Co-operative Society" in flags[0]["message"]

    listed = by_id[first]
    assert listed["registration_number"] == "CS/12345" and listed["kra_pin"] == "P051234567Z"
    assert listed["admin_id_number"] == "28491029" and listed["county"] == "Kiambu"
    assert listed["estimated_daily_liters"] == 4500 and listed["initial_coolers_count"] == 3


def test_shared_id_number_is_flagged(client, superadmin_headers):
    client.post(REGISTER, json=application())
    res = client.post(REGISTER, json=application(
        cooperative_name="Kericho Tea Dairy", admin_email="b@example.com", admin_phone="0733000000",
        registration_number="CS/2", kra_pin="A000000001Z",
    ))
    assert res.status_code == 201
    codes = [f["code"] for a in client.get(PENDING, headers=superadmin_headers).json() for f in a["flags"]]
    assert codes == ["SHARED_ID_NUMBER"]


# 5 ---------------------------------------------------------------------------

def test_rejected_applicant_can_apply_again_and_is_flagged(client, session, superadmin_headers):
    app_id = client.post(REGISTER, json=application()).json()["application_id"]
    res = decide(client, superadmin_headers, app_id, "REJECT", "Certificate could not be verified")
    assert res.status_code == 200, res.text

    rejected = session.get(CooperativeApplication, uuid.UUID(app_id))
    assert rejected.rejection_reason == "Certificate could not be verified"
    assert rejected.reviewed_by and rejected.reviewed_at and rejected.admin_user_id is None
    assert session.query(User).filter_by(email="jane@limurudairy.co.ke").count() == 0

    again = client.post(REGISTER, json=application())
    assert again.status_code == 201, again.text

    pending = client.get(PENDING, headers=superadmin_headers).json()
    assert len(pending) == 1
    assert [f["code"] for f in pending[0]["flags"]] == ["PREVIOUSLY_REJECTED"]
    assert "Certificate could not be verified" in pending[0]["flags"][0]["message"]


def test_reject_requires_a_reason(client, superadmin_headers):
    app_id = client.post(REGISTER, json=application()).json()["application_id"]
    assert decide(client, superadmin_headers, app_id, "REJECT").status_code == 422


# 6 ---------------------------------------------------------------------------

@pytest.mark.parametrize("first,second", [
    ("APPROVE", "APPROVE"), ("APPROVE", "REJECT"), ("REJECT", "REJECT"), ("REJECT", "APPROVE"),
])
def test_deciding_twice_is_409(client, superadmin_headers, first, second):
    app_id = client.post(REGISTER, json=application()).json()["application_id"]
    reason = "Documents are incomplete"
    assert decide(client, superadmin_headers, app_id, first, reason).status_code == 200
    res = decide(client, superadmin_headers, app_id, second, reason)
    assert res.status_code == 409
    assert "already" in res.json()["detail"]


def test_only_superadmin_can_decide(client, superadmin_headers):
    app_id = client.post(REGISTER, json=application()).json()["application_id"]
    decide(client, superadmin_headers, app_id, "APPROVE")
    token = login(client, "jane@limurudairy.co.ke", PASSWORD).json()["access_token"]
    other = client.post(REGISTER, json=application(
        admin_email="b@example.com", admin_phone="0733000000", registration_number="CS/2",
        kra_pin="A000000001Z", cooperative_name="Nyeri Hills", admin_id_number="11112222",
    )).json()["application_id"]
    res = decide(client, {"Authorization": f"Bearer {token}"}, other, "APPROVE")
    assert res.status_code == 403


# refresh -----------------------------------------------------------------------

def test_refresh_refuses_a_deactivated_user(client, session, superadmin_headers):
    res = client.post("/api/v1/auth/refresh", headers=superadmin_headers)
    assert res.status_code == 200 and res.json()["role"] == "SUPER_ADMIN"
    client.cookies.clear()

    session.query(User).filter_by(role=UserRole.SUPER_ADMIN).update({"is_active": False})
    session.commit()
    assert client.post("/api/v1/auth/refresh", headers=superadmin_headers).status_code == 401
