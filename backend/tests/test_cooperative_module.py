import pytest

from core.security import hash_password
from models.cooperative import Cooperative
from models.user import User
from schemas.auth import UserRole
from tests.conftest import login

PASSWORD = "Dairy#2026x"
BASE = "/api/v1/cooperative"


def make_coop(session, n: int, **overrides) -> Cooperative:
    coop = Cooperative(
        name=f"Coop {n}", code=f"COOP-{n}", registration_number=f"CS/{n}0000", kra_pin=f"P05123456{n}Z",
        county="Kiambu", location="Limuru", **overrides,
    )
    session.add(coop)
    session.commit()
    return coop


def make_user(session, coop, role, email, phone, active=True) -> User:
    user = User(
        email=email, password_hash=hash_password(PASSWORD), full_name=email.split("@")[0].title() + " Person",
        phone_number=phone, role=role, cooperative_id=coop.id if coop else None, is_active=active,
    )
    session.add(user)
    session.commit()
    return user


def headers_for(client, email, password=PASSWORD):
    res = login(client, email, password)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def world(client, session):
    """Two cooperatives, each with an admin and a manager."""
    a, b = make_coop(session, 1), make_coop(session, 2)
    make_user(session, a, UserRole.COOP_ADMIN, "admin@a.coop", "+254700000011")
    make_user(session, a, UserRole.MANAGER, "manager@a.coop", "+254700000012")
    make_user(session, b, UserRole.COOP_ADMIN, "admin@b.coop", "+254700000021")
    return {
        "a": a, "b": b,
        "admin_a": headers_for(client, "admin@a.coop"),
        "manager_a": headers_for(client, "manager@a.coop"),
        "admin_b": headers_for(client, "admin@b.coop"),
    }


def farmer(**overrides):
    data = {"first_name": "Jane", "last_name": "Wanjiku", "phone": "0712 345 678"}
    data.update(overrides)
    return data


def field_of(res):
    return [d["loc"][-1] for d in res.json()["detail"]]


# ---------------- access ----------------

def test_requires_login_and_a_cooperative_role(client, session, world):
    assert client.get(f"{BASE}/overview").status_code == 401

    for role, n in ((UserRole.FARMER, 1), (UserRole.COLLECTOR, 2)):
        make_user(session, world["a"], role, f"{role.value.lower()}@a.coop", f"+25470000010{n}")
        assert client.get(f"{BASE}/overview", headers=headers_for(client, f"{role.value.lower()}@a.coop")).status_code == 403

    make_user(session, None, UserRole.SUPER_ADMIN, "root@x.coop", "+254700000199")
    assert client.get(f"{BASE}/overview", headers=headers_for(client, "root@x.coop")).status_code == 403

    make_user(session, None, UserRole.COOP_ADMIN, "orphan@x.coop", "+254700000198")
    res = client.get(f"{BASE}/overview", headers=headers_for(client, "orphan@x.coop"))
    assert res.status_code == 403 and "not linked" in res.json()["detail"]


def test_suspended_cooperative_is_locked_out(client, session, world):
    world["a"].status = "SUSPENDED"
    session.commit()
    res = client.get(f"{BASE}/overview", headers=world["admin_a"])
    assert res.status_code == 403 and "suspended" in res.json()["detail"]


def test_deactivated_user_loses_access_immediately(client, session, world):
    user = session.query(User).filter_by(email="manager@a.coop").one()
    user.is_active = False
    session.commit()
    assert client.get(f"{BASE}/overview", headers=world["manager_a"]).status_code == 401


# ---------------- overview ----------------

def test_overview_counts(client, world):
    h = world["admin_a"]
    first = client.get(f"{BASE}/overview", headers=h).json()
    assert first["role"] == "COOP_ADMIN"
    assert first["cooperative"]["name"] == "Coop 1"
    assert first["farmers"] == {"total": 0, "active": 0, "unassigned": 0}
    assert first["team"] == {"admins": 1, "managers": 1, "collectors": 0}

    centre = client.post(f"{BASE}/centres", json={"name": "Limuru Centre", "has_cooler": True, "cooler_capacity_litres": 2000}, headers=h).json()
    client.post(f"{BASE}/farmers", json=farmer(centre_id=centre["id"]), headers=h)
    client.post(f"{BASE}/farmers", json=farmer(first_name="Peter", phone="0722000111"), headers=h)

    data = client.get(f"{BASE}/overview", headers=h).json()
    assert data["farmers"] == {"total": 2, "active": 2, "unassigned": 1}
    assert data["centres"] == {"total": 1, "active": 1, "with_cooler": 1}
    assert len(data["recent_farmers"]) == 2

    other = client.get(f"{BASE}/overview", headers=world["admin_b"]).json()
    assert other["farmers"]["total"] == 0 and other["centres"]["total"] == 0


# ---------------- collection centres ----------------

def test_centre_lifecycle(client, world):
    h = world["admin_a"]
    one = client.post(f"{BASE}/centres", json={"name": "  Limuru   Centre "}, headers=h)
    assert one.status_code == 201
    body = one.json()
    assert body["name"] == "Limuru Centre"
    assert body["code"] == "CTR-001" and body["county"] == "Kiambu" and body["status"] == "ACTIVE"
    assert client.post(f"{BASE}/centres", json={"name": "Second"}, headers=h).json()["code"] == "CTR-002"

    patched = client.patch(f"{BASE}/centres/{body['id']}", json={"name": "Limuru North", "has_cooler": True, "cooler_capacity_litres": 1500}, headers=h).json()
    assert patched["name"] == "Limuru North" and patched["has_cooler"] and patched["cooler_capacity_litres"] == 1500

    # turning the cooler off drops the capacity
    assert client.patch(f"{BASE}/centres/{body['id']}", json={"has_cooler": False}, headers=h).json()["cooler_capacity_litres"] is None

    off = client.patch(f"{BASE}/centres/{body['id']}", json={"status": "INACTIVE"}, headers=h).json()
    assert off["status"] == "INACTIVE"
    listed = client.get(f"{BASE}/centres", headers=h).json()
    assert [(c["name"], c["code"], c["status"]) for c in listed] == [("Limuru North", "CTR-001", "INACTIVE"), ("Second", "CTR-002", "ACTIVE")]


def test_centre_validation_and_duplicates(client, world):
    h = world["admin_a"]
    assert client.post(f"{BASE}/centres", json={"name": "x"}, headers=h).status_code == 422
    assert client.post(f"{BASE}/centres", json={"name": "Valid", "county": "Atlantis"}, headers=h).status_code == 422
    assert client.post(f"{BASE}/centres", json={"name": "Valid", "code": "bad code!"}, headers=h).status_code == 422

    assert client.post(f"{BASE}/centres", json={"name": "One", "code": "main"}, headers=h).json()["code"] == "MAIN"
    dup = client.post(f"{BASE}/centres", json={"name": "Two", "code": "MAIN"}, headers=h)
    assert dup.status_code == 409 and field_of(dup) == ["code"]

    # the same code is fine in a different cooperative
    assert client.post(f"{BASE}/centres", json={"name": "One", "code": "MAIN"}, headers=world["admin_b"]).status_code == 201

    other = client.post(f"{BASE}/centres", json={"name": "Three", "code": "NORTH"}, headers=h).json()
    clash = client.patch(f"{BASE}/centres/{other['id']}", json={"code": "main"}, headers=h)
    assert clash.status_code == 409
    assert client.patch(f"{BASE}/centres/{other['id']}", json={"name": None}, headers=h).status_code == 422


def test_centre_manager_must_be_an_active_manager_of_this_cooperative(client, session, world):
    h = world["admin_a"]
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    ok = client.post(f"{BASE}/centres", json={"name": "Managed", "manager_user_id": str(manager.id)}, headers=h)
    assert ok.status_code == 201 and ok.json()["manager_name"] == manager.full_name

    for bad in (
        str(session.query(User).filter_by(email="admin@a.coop").one().id),  # not a MANAGER
        str(session.query(User).filter_by(email="admin@b.coop").one().id),  # other cooperative
        "00000000-0000-0000-0000-000000000000",
    ):
        res = client.post(f"{BASE}/centres", json={"name": "Bad", "manager_user_id": bad}, headers=h)
        assert res.status_code == 422 and field_of(res) == ["manager_user_id"]


def test_centres_are_isolated_between_cooperatives(client, world):
    centre = client.post(f"{BASE}/centres", json={"name": "Private"}, headers=world["admin_a"]).json()
    assert client.get(f"{BASE}/centres", headers=world["admin_b"]).json() == []
    assert client.patch(f"{BASE}/centres/{centre['id']}", json={"name": "Hijack"}, headers=world["admin_b"]).status_code == 404
    assert client.patch(f"{BASE}/centres/not-a-uuid", json={"name": "Hijack"}, headers=world["admin_b"]).status_code == 404


def test_manager_can_manage_centres(client, world):
    res = client.post(f"{BASE}/centres", json={"name": "By Manager"}, headers=world["manager_a"])
    assert res.status_code == 201


# ---------------- farmers ----------------

def test_farmer_creation_normalises_and_numbers(client, world):
    h = world["admin_a"]
    one = client.post(f"{BASE}/farmers", json=farmer(national_id=" 12345678 ", village="  Kamirithu "), headers=h)
    assert one.status_code == 201
    body = one.json()
    assert body["farmer_number"] == "F-0001" and body["phone"] == "+254712345678"
    assert body["national_id"] == "12345678" and body["village"] == "Kamirithu" and body["status"] == "ACTIVE"
    assert client.post(f"{BASE}/farmers", json=farmer(phone="0722 000 111"), headers=h).json()["farmer_number"] == "F-0002"

    custom = client.post(f"{BASE}/farmers", json=farmer(phone="0733000111", farmer_number="mem/77"), headers=h)
    assert custom.json()["farmer_number"] == "MEM/77"


@pytest.mark.parametrize("field,value", [
    ("phone", "0812345678"), ("phone", "12"), ("national_id", "123"), ("first_name", ""), ("farmer_number", "!!"),
])
def test_farmer_validation(client, world, field, value):
    res = client.post(f"{BASE}/farmers", json=farmer(**{field: value}), headers=world["admin_a"])
    assert res.status_code == 422 and field in field_of(res)


def test_farmer_duplicates_are_per_cooperative(client, world):
    h = world["admin_a"]
    client.post(f"{BASE}/farmers", json=farmer(national_id="12345678", farmer_number="F-9"), headers=h)

    for overrides, field in (
        ({"phone": "+254 712 345 678", "national_id": "87654321"}, "phone"),
        ({"phone": "0799000000", "national_id": "12345678"}, "national_id"),
        ({"phone": "0799000000", "farmer_number": "f-9"}, "farmer_number"),
    ):
        res = client.post(f"{BASE}/farmers", json=farmer(**overrides), headers=h)
        assert res.status_code == 409 and field_of(res) == [field], overrides

    # the same person can be registered by another cooperative
    assert client.post(f"{BASE}/farmers", json=farmer(national_id="12345678"), headers=world["admin_b"]).status_code == 201


def test_farmer_centre_must_belong_to_the_cooperative(client, world):
    theirs = client.post(f"{BASE}/centres", json={"name": "Theirs"}, headers=world["admin_b"]).json()
    res = client.post(f"{BASE}/farmers", json=farmer(centre_id=theirs["id"]), headers=world["admin_a"])
    assert res.status_code == 422 and field_of(res) == ["centre_id"]

    mine = client.post(f"{BASE}/centres", json={"name": "Mine"}, headers=world["admin_a"]).json()
    created = client.post(f"{BASE}/farmers", json=farmer(centre_id=mine["id"]), headers=world["admin_a"]).json()
    assert created["centre_name"] == "Mine"
    assert client.get(f"{BASE}/centres", headers=world["admin_a"]).json()[0]["farmer_count"] == 1


def test_farmer_update_and_deactivate(client, world):
    h = world["admin_a"]
    created = client.post(f"{BASE}/farmers", json=farmer(), headers=h).json()
    other = client.post(f"{BASE}/farmers", json=farmer(first_name="Peter", phone="0722000111"), headers=h).json()
    url = f"{BASE}/farmers/{created['id']}"

    updated = client.patch(url, json={"village": "Tigoni", "phone": "0700 111 222"}, headers=h).json()
    assert updated["village"] == "Tigoni" and updated["phone"] == "+254700111222"

    assert client.patch(url, json={"phone": other["phone"]}, headers=h).status_code == 409
    assert client.patch(url, json={"phone": "0700111222"}, headers=h).status_code == 200  # your own number is not a clash
    assert client.patch(url, json={"first_name": None}, headers=h).status_code == 422

    assert client.patch(url, json={"status": "INACTIVE"}, headers=h).json()["status"] == "INACTIVE"
    assert client.patch(url, json={"centre_id": None}, headers=h).json()["centre_id"] is None
    assert client.patch(url, json={"status": "BANNED"}, headers=h).status_code == 422

    assert client.patch(url, json={"village": "Hijack"}, headers=world["admin_b"]).status_code == 404


def test_farmer_search_filter_and_paging(client, world):
    h = world["admin_a"]
    centre = client.post(f"{BASE}/centres", json={"name": "Hub"}, headers=h).json()
    people = [
        ("Jane", "Wanjiku", "0712000001", "Limuru", centre["id"]),
        ("Janet", "Kamau", "0712000002", "Tigoni", None),
        ("Peter", "Mwangi", "0722000003", "Limuru", centre["id"]),
        ("Mary", "Njeri", "0733000004", "Kikuyu", None),
    ]
    for first, last, phone, village, centre_id in people:
        assert client.post(f"{BASE}/farmers", json=farmer(first_name=first, last_name=last, phone=phone, village=village, centre_id=centre_id), headers=h).status_code == 201
    client.patch(f"{BASE}/farmers/{client.get(f'{BASE}/farmers?search=Mary', headers=h).json()['items'][0]['id']}", json={"status": "INACTIVE"}, headers=h)

    def names(query):
        res = client.get(f"{BASE}/farmers{query}", headers=h)
        assert res.status_code == 200
        return [i["first_name"] for i in res.json()["items"]], res.json()["total"]

    assert names("") == (["Janet", "Peter", "Mary", "Jane"], 4)  # sorted by last name: Kamau, Mwangi, Njeri, Wanjiku
    assert names("?search=jane")[1] == 2                       # Jane and Janet
    assert names("?search=jane limuru") == (["Jane"], 1)       # every word must match
    assert names("?search=0722000003") == (["Peter"], 1)       # local phone format
    assert names("?search=%2B254722000003") == (["Peter"], 1)  # E.164
    assert names("?search=722")[0] == ["Peter"]                # partial digits
    assert names("?search=100%25")[1] == 0                      # '%' is literal, not a wildcard
    assert names(f"?centre_id={centre['id']}")[1] == 2
    assert names("?centre_id=none")[1] == 2
    assert names("?status=INACTIVE") == (["Mary"], 1)
    assert client.get(f"{BASE}/farmers?centre_id=oops", headers=h).status_code == 404

    first_page = client.get(f"{BASE}/farmers?page=1&page_size=3", headers=h).json()
    second_page = client.get(f"{BASE}/farmers?page=2&page_size=3", headers=h).json()
    assert (len(first_page["items"]), len(second_page["items"]), first_page["total"]) == (3, 1, 4)
    assert client.get(f"{BASE}/farmers?page_size=1000", headers=h).status_code == 422

    assert client.get(f"{BASE}/farmers", headers=world["admin_b"]).json()["total"] == 0


# ---------------- team ----------------

def team_member(**overrides):
    data = {"full_name": "Paul Collector", "email": "Paul@A.coop", "phone": "0711 222 333", "role": "COLLECTOR", "password": PASSWORD}
    data.update(overrides)
    return data


def test_admin_creates_a_team_member_who_can_log_in(client, world):
    res = client.post(f"{BASE}/team", json=team_member(), headers=world["admin_a"])
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "paul@a.coop" and body["phone_number"] == "+254711222333"
    assert body["role"] == "COLLECTOR" and body["is_active"] is True
    assert "password" not in str(body).lower()

    logged_in = login(client, "paul@a.coop", PASSWORD)
    assert logged_in.status_code == 200 and logged_in.json()["role"] == "COLLECTOR"

    roster = client.get(f"{BASE}/team", headers=world["admin_a"]).json()
    assert [m["role"] for m in roster] == ["COOP_ADMIN", "MANAGER", "COLLECTOR"]
    assert [m["is_you"] for m in roster] == [True, False, False]
    assert [m["email"] for m in client.get(f"{BASE}/team", headers=world["admin_b"]).json()] == ["admin@b.coop"]


def test_team_validation_and_conflicts(client, world):
    h = world["admin_a"]
    for overrides in ({"role": "COOP_ADMIN"}, {"role": "FARMER"}, {"password": "weakpass"}, {"password": "Sh0rt"}, {"phone": "0812"}, {"email": "nope"}):
        assert client.post(f"{BASE}/team", json=team_member(**overrides), headers=h).status_code == 422, overrides

    assert client.post(f"{BASE}/team", json=team_member(), headers=h).status_code == 201
    assert field_of(client.post(f"{BASE}/team", json=team_member(phone="0700 000 001"), headers=h)) == ["email"]
    assert field_of(client.post(f"{BASE}/team", json=team_member(email="new@a.coop"), headers=h)) == ["phone"]
    # accounts are unique across the whole platform
    assert client.post(f"{BASE}/team", json=team_member(email="admin@b.coop"), headers=h).status_code == 409


def test_manager_can_read_but_not_change_the_team(client, world):
    assert client.get(f"{BASE}/team", headers=world["manager_a"]).status_code == 200
    assert client.post(f"{BASE}/team", json=team_member(), headers=world["manager_a"]).status_code == 403
    member = client.post(f"{BASE}/team", json=team_member(), headers=world["admin_a"]).json()
    assert client.patch(f"{BASE}/team/{member['id']}", json={"is_active": False}, headers=world["manager_a"]).status_code == 403


def test_deactivate_change_role_and_reset_password(client, world):
    h = world["admin_a"]
    member = client.post(f"{BASE}/team", json=team_member(), headers=h).json()
    url = f"{BASE}/team/{member['id']}"

    assert client.patch(url, json={"role": "MANAGER", "full_name": "Paul Senior"}, headers=h).json()["role"] == "MANAGER"
    assert client.patch(url, json={"password": "Fresh#Pass9"}, headers=h).status_code == 200
    assert login(client, "paul@a.coop", PASSWORD).status_code == 401
    assert login(client, "paul@a.coop", "Fresh#Pass9").status_code == 200

    assert client.patch(url, json={"is_active": False}, headers=h).json()["is_active"] is False
    assert login(client, "paul@a.coop", "Fresh#Pass9").status_code == 403

    assert client.patch(url, json={"is_active": True}, headers=h).json()["is_active"] is True
    assert client.patch(url, json={"role": "COOP_ADMIN"}, headers=h).status_code == 422
    assert client.patch(url, json={"phone": "0700000011"}, headers=h).status_code == 409   # the admin's own number
    assert client.patch(url, json={"password": "weak"}, headers=h).status_code == 422


def test_team_changes_are_limited_to_own_cooperative_and_non_admins(client, world):
    member = client.post(f"{BASE}/team", json=team_member(), headers=world["admin_a"]).json()
    assert client.patch(f"{BASE}/team/{member['id']}", json={"is_active": False}, headers=world["admin_b"]).status_code == 404

    admin_row = next(m for m in client.get(f"{BASE}/team", headers=world["admin_a"]).json() if m["role"] == "COOP_ADMIN")
    res = client.patch(f"{BASE}/team/{admin_row['id']}", json={"is_active": False}, headers=world["admin_a"])
    assert res.status_code == 403