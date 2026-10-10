"""Account lifecycle and security: invitation, SMS activation, phone verification, passwords, MFA, sessions,
role-scoped settings, SMS billing and tenant isolation of the account endpoints."""
import datetime
import json

import pytest

from core.validation import mask_phone_local, normalize_phone
from models.admin import AuditLog
from models.finance import CreditTxn, SmsCreditTransaction
from models.notifications import Notification
from models.user import AccountActivation, PasswordReset, PhoneVerification, User
from schemas.auth import UserRole
from services import mfa, notifications, sms
from tests.conftest import RecordingSms, activate, fund, login
from tests.test_cooperative_module import PASSWORD, headers_for, make_coop, make_user

COOP = "/api/v1/cooperative"
SA = "/api/v1/superadmin"
AUTH = "/api/v1/auth"
ACC = "/api/v1/account"
NEW_PHONE = "+254711222333"


@pytest.fixture
def world(client, session, sms_outbox):
    a, b = make_coop(session, 1), make_coop(session, 2)
    make_user(session, a, UserRole.COOP_ADMIN, "admin@a.coop", "+254700000011")
    make_user(session, a, UserRole.MANAGER, "manager@a.coop", "+254700000012")
    make_user(session, b, UserRole.COOP_ADMIN, "admin@b.coop", "+254700000021")
    fund(session, a.id, 50)
    return {
        "a": a, "b": b, "sms": sms_outbox,
        "admin_a": headers_for(client, "admin@a.coop"),
        "manager_a": headers_for(client, "manager@a.coop"),
        "admin_b": headers_for(client, "admin@b.coop"),
    }


def invite_collector(client, w, phone="0711 222 333", email="paul@a.coop"):
    res = client.post(f"{COOP}/team", json={"full_name": "Paul Collector", "email": email, "phone": phone, "role": "COLLECTOR"},
                      headers=w["admin_a"])
    assert res.status_code == 201, res.text
    return res.json()


def bearer(res):
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def available(session, coop_id):
    from services import sms_credits

    session.expire_all()
    return sms_credits.available(session, coop_id)


# ---------------- phone numbers ----------------

@pytest.mark.parametrize("raw", ["0712345678", "+254712345678", "254712345678", "0712 345 678", "712345678"])
def test_kenyan_numbers_normalise_to_e164(raw):
    assert normalize_phone(raw) == "+254712345678"


def test_newer_prefixes_and_masking():
    assert normalize_phone("0112345678") == "+254112345678"
    assert normalize_phone("+254112345678") == "+254112345678"
    assert mask_phone_local("+254712345656") == "0712••••56"
    with pytest.raises(ValueError):
        normalize_phone("0812345678")


def test_same_number_in_another_format_is_a_duplicate(client, world):
    invite_collector(client, world, phone="0711222333")
    dup = client.post(f"{COOP}/team", json={"full_name": "Other Person", "email": "x@a.coop", "phone": "+254711222333", "role": "COLLECTOR"},
                      headers=world["admin_a"])
    assert dup.status_code == 409 and dup.json()["detail"][0]["loc"][-1] == "phone"


# ---------------- creation & role authorisation ----------------

def test_invited_account_is_pending_without_a_password(client, session, world):
    body = invite_collector(client, world)
    user = session.get(User, __import__("uuid").UUID(body["id"]))
    assert user.password_hash is None and user.account_status == "PENDING_ACTIVATION" and user.is_active is False
    assert body["activation"]["link_state"] == "SENT" and body["activation_sms"]["sms_status"] == "SENT"
    # The raw token exists only in the SMS: not in the stored notification, not in the audit trail.
    token = world["sms"].token_for(NEW_PHONE)
    stored = session.query(Notification).filter_by(type="ACCOUNT_ACTIVATION").one()
    assert token not in stored.message and "[one-time link hidden]" in stored.message
    assert token not in json.dumps([[a.target, a.new_values, a.old_values] for a in session.query(AuditLog).all()], default=str)
    assert session.query(AccountActivation).one().token_hash != token


def test_role_rules_for_creating_accounts(client, world, superadmin_headers):
    team = {"full_name": "Someone New", "email": "new@a.coop", "phone": "0733000001"}
    # Managers can't add team members; a cooperative admin can't create another admin or a superadmin.
    assert client.post(f"{COOP}/team", json={**team, "role": "COLLECTOR"}, headers=world["manager_a"]).status_code == 403
    assert client.post(f"{COOP}/team", json={**team, "role": "COOP_ADMIN"}, headers=world["admin_a"]).status_code == 422
    assert client.post(f"{SA}/users", json={**team, "role": "SUPER_ADMIN"}, headers=world["admin_a"]).status_code == 403
    assert client.post(f"{SA}/users", json={**team, "role": "SUPER_ADMIN"}, headers=world["manager_a"]).status_code == 403
    # Managers need an email; collectors don't.
    assert client.post(f"{COOP}/team", json={**team, "email": None, "role": "MANAGER"}, headers=world["admin_a"]).status_code == 422
    assert client.post(f"{COOP}/team", json={**team, "email": None, "role": "COLLECTOR"}, headers=world["admin_a"]).status_code == 201


# ---------------- activation ----------------

def test_activation_with_code_then_normal_sign_in(client, session, world):
    invite_collector(client, world)
    token = world["sms"].token_for(NEW_PHONE)
    page = client.post(f"{AUTH}/activation/inspect", json={"token": token}).json()
    assert page["state"] == "VALID" and page["phone_masked"] == "0711••••33" and page["role"] == "COLLECTOR"
    assert page["cooperative_name"] == "Coop 1" and page["requires_otp"] is True

    # The password can't be set before the phone is confirmed.
    assert client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "Paul#Own2026"}).status_code == 400
    assert client.post(f"{AUTH}/activation/send-code", json={"token": token}).json()["sms_sent"] is True
    assert client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": "000000"}).status_code == 400
    code = world["sms"].code_for(NEW_PHONE)
    assert client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": code}).status_code == 200
    # Password rules apply.
    assert client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "weakpass"}).status_code == 422
    done = client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "Paul#Own2026"})
    assert done.status_code == 200 and done.json()["activated"] is True

    user = session.query(User).filter_by(phone_number=NEW_PHONE).one()
    session.refresh(user)
    assert user.account_status == "ACTIVE" and user.phone_verified_at and user.activated_at
    assert login(client, "paul@a.coop", "Paul#Own2026").status_code == 200
    # Single use.
    again = client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "Other#Pass1"})
    assert again.status_code == 410
    assert client.post(f"{AUTH}/activation/inspect", json={"token": token}).json() == {"state": "USED", "can_request_new_link": False}
    actions = {a.action for a in session.query(AuditLog).filter_by(entity_type="security").all()}
    assert {"ACCOUNT_CREATED", "ACTIVATION_SMS_SENT", "ACTIVATION_LINK_OPENED", "OTP_REQUESTED", "OTP_FAILED",
            "OTP_VERIFIED", "PASSWORD_CREATED", "ACTIVATION_COMPLETED"} <= actions


def test_invalid_and_expired_links_reveal_nothing(client, session, world):
    assert client.post(f"{AUTH}/activation/inspect", json={"token": "not-a-real-token-at-all"}).json() == {"state": "INVALID", "can_request_new_link": False}
    invite_collector(client, world)
    token = world["sms"].token_for(NEW_PHONE)
    row = session.query(AccountActivation).one()
    row.expires_at = datetime.datetime.utcnow() - datetime.timedelta(minutes=1)
    row.created_at = datetime.datetime.utcnow() - datetime.timedelta(minutes=31)
    session.commit()
    page = client.post(f"{AUTH}/activation/inspect", json={"token": token}).json()
    assert page == {"state": "EXPIRED", "can_request_new_link": True}  # no name, phone or cooperative
    assert client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "Paul#Own2026"}).status_code == 410
    # Asking for a new link from the expired one works, with a generic answer.
    res = client.post(f"{AUTH}/activation/resend", json={"token": token})
    assert res.status_code == 200 and "If the account exists" in res.json()["message"]
    assert world["sms"].token_for(NEW_PHONE) != token


def test_resend_revokes_the_old_link_and_has_a_cooldown(client, session, world):
    member = invite_collector(client, world)
    first = world["sms"].token_for(NEW_PHONE)
    url = f"{COOP}/accounts/{member['id']}/resend-activation"
    assert client.post(url, headers=world["admin_a"]).status_code == 429  # just sent
    session.query(AccountActivation).update({AccountActivation.created_at: datetime.datetime.utcnow() - datetime.timedelta(minutes=5)})
    session.commit()
    res = client.post(url, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["activation_sms"]["sms_sent"] is True
    second = world["sms"].token_for(NEW_PHONE)
    assert second != first
    assert client.post(f"{AUTH}/activation/inspect", json={"token": first}).json()["state"] == "REVOKED"
    assert client.post(f"{AUTH}/activation/inspect", json={"token": second}).json()["state"] == "VALID"
    assert session.query(AuditLog).filter_by(action="ACTIVATION_RESENT").count() == 1


def test_public_resend_never_says_whether_an_account_exists(client, world):
    invite_collector(client, world)
    known = client.post(f"{AUTH}/activation/resend", json={"identifier": "0711222333"}).json()
    unknown = client.post(f"{AUTH}/activation/resend", json={"identifier": "0799999999"}).json()
    assert known == unknown


def test_revoked_invitation_can_not_be_activated(client, session, world):
    member = invite_collector(client, world)
    token = world["sms"].token_for(NEW_PHONE)
    res = client.post(f"{COOP}/accounts/{member['id']}/revoke-invitation", json={"reason": "Wrong person"}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["account_status"] == "DISABLED"
    assert client.post(f"{AUTH}/activation/inspect", json={"token": token}).json()["state"] == "REVOKED"
    assert client.post(f"{AUTH}/activation/complete", json={"token": token, "password": "Paul#Own2026"}).status_code == 410


def test_pending_account_is_told_to_activate_and_can_not_reach_the_api(client, session, world):
    invite_collector(client, world)
    res = login(client, "paul@a.coop", "anything")
    assert res.status_code == 403 and "activated" in res.json()["detail"] and res.headers["x-error-code"] == "activation_required"
    # A forged token for the pending account is refused by every protected endpoint.
    from core.security import access_token_for

    user = session.query(User).filter_by(phone_number=NEW_PHONE).one()
    forged = {"Authorization": f"Bearer {access_token_for(user)}"}
    assert client.get(f"{ACC}/me", headers=forged).status_code == 401
    assert client.get("/api/v1/collections/options", headers=forged).status_code == 401


def test_otp_expiry_attempt_limit_and_resend_cooldown(client, session, world):
    invite_collector(client, world)
    token = world["sms"].token_for(NEW_PHONE)
    assert client.post(f"{AUTH}/activation/send-code", json={"token": token}).status_code == 200
    assert client.post(f"{AUTH}/activation/send-code", json={"token": token}).status_code == 429  # cooldown
    for _ in range(4):
        assert client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": "111111"}).status_code == 400
    last = client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": "111111"})
    assert last.status_code == 400 and "Too many" in last.json()["detail"]
    # Even the right code is refused once the attempts are used up.
    good = world["sms"].code_for(NEW_PHONE)
    assert client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": good}).status_code == 400
    # A new code (after the cooldown) works until it expires.
    session.query(PhoneVerification).update({PhoneVerification.last_sent_at: datetime.datetime.utcnow() - datetime.timedelta(minutes=2)})
    session.commit()
    assert client.post(f"{AUTH}/activation/send-code", json={"token": token}).status_code == 200
    fresh = world["sms"].code_for(NEW_PHONE)
    session.query(PhoneVerification).filter(PhoneVerification.revoked_at.is_(None)).update(
        {PhoneVerification.expires_at: datetime.datetime.utcnow() - datetime.timedelta(seconds=1)})
    session.commit()
    expired = client.post(f"{AUTH}/activation/verify-code", json={"token": token, "code": fresh})
    assert expired.status_code == 400 and "expired" in expired.json()["detail"]
    # Codes are never stored in plain text.
    assert all(fresh not in (v.code_hash or "") for v in session.query(PhoneVerification).all())


# ---------------- SMS billing through the ledger ----------------

def test_activation_sms_reserves_and_consumes_one_cooperative_credit(client, session, world):
    before = available(session, world["a"].id)
    invite_collector(client, world)
    assert available(session, world["a"].id) == before - 1
    kinds = [t.transaction_type for t in session.query(SmsCreditTransaction).filter(SmsCreditTransaction.reference.like("sms:%")).all()]
    assert sorted(kinds) == [CreditTxn.CONSUMED, CreditTxn.RESERVED]


def test_failed_activation_sms_is_refunded_never_reported_sent_and_not_auto_retried(client, session, world):
    sms.set_provider(RecordingSms(accept=False))
    before = available(session, world["a"].id)
    body = invite_collector(client, world)
    assert body["activation_sms"]["sms_sent"] is False and body["activation"]["sms_status"] in ("FAILED", "REFUNDED")
    assert available(session, world["a"].id) == before  # reserved, then refunded
    kinds = sorted(t.transaction_type for t in session.query(SmsCreditTransaction).filter(SmsCreditTransaction.reference.like("sms:%")))
    assert kinds == [CreditTxn.REFUNDED, CreditTxn.RESERVED]
    # The background retry never resends a message whose link it doesn't have.
    n = session.query(Notification).filter_by(type="ACCOUNT_ACTIVATION").one()
    assert n.next_attempt_at is None
    assert notifications.dispatch_due(session, world["a"].id) == []
    assert session.query(AuditLog).filter_by(action="ACTIVATION_SMS_FAILED").count() == 1
    # Retrying = a NEW link once the provider works again.
    sms.set_provider(world["sms"])
    session.query(AccountActivation).update({AccountActivation.created_at: datetime.datetime.utcnow() - datetime.timedelta(minutes=5)})
    session.commit()
    res = client.post(f"{COOP}/accounts/{body['id']}/resend-activation", headers=world["admin_a"])
    assert res.json()["activation_sms"]["sms_sent"] is True


def test_no_provider_means_not_sent(client, session, world):
    sms.set_provider(None)
    body = invite_collector(client, world)
    assert body["activation_sms"] == {"sms_status": "PENDING_PROVIDER", "sms_sent": False, "sms_error": "SMS provider not configured"}


def test_platform_staff_invitations_do_not_use_cooperative_credits(client, session, world, superadmin_headers):
    before = available(session, world["b"].id)
    res = client.post(f"{SA}/users", headers=superadmin_headers, json={
        "full_name": "Mike Manager", "email": "mike@b.coop", "phone": "0733000002", "role": "MANAGER", "cooperative_id": str(world["b"].id),
    })
    assert res.status_code == 201 and res.json()["activation_sms"]["sms_sent"] is True
    assert available(session, world["b"].id) == before == 0


def test_delivery_reports_need_the_shared_token(client, session, world, monkeypatch):
    invite_collector(client, world)
    n = session.query(Notification).filter_by(type="ACCOUNT_ACTIVATION").one()
    assert client.post(f"{AUTH}/sms/delivery-report", data={"id": n.provider_message_id, "status": "Success"}).status_code == 404
    monkeypatch.setenv("SMS_DELIVERY_REPORT_TOKEN", "s3cret")
    assert client.post(f"{AUTH}/sms/delivery-report?token=wrong", data={"id": n.provider_message_id, "status": "Success"}).status_code == 404
    assert client.post(f"{AUTH}/sms/delivery-report?token=s3cret", data={"id": n.provider_message_id, "status": "Success"}).status_code == 200
    session.refresh(n)
    assert n.status == "DELIVERED" and n.delivered_at is not None


# ---------------- sign-in security ----------------

def test_sign_in_by_phone_lockout_and_events(client, session, world):
    assert client.post(f"{AUTH}/login", json={"identifier": "0700000011", "password": PASSWORD}).status_code == 200
    client.cookies.clear()
    for _ in range(5):
        assert login(client, "admin@a.coop", "Wrong#Pass1").status_code == 401
    locked = login(client, "admin@a.coop", PASSWORD)
    assert locked.status_code == 429  # locked even with the right password
    actions = [a.action for a in session.query(AuditLog).filter_by(entity_type="security").all()]
    assert actions.count("LOGIN_FAILED") == 5 and "LOGIN_LOCKED" in actions and "LOGIN_SUCCESS" in actions
    # Unknown accounts get the same answer as a wrong password.
    assert login(client, "nobody@a.coop", PASSWORD).json()["detail"] == "Invalid email or password"


def test_suspension_blocks_sign_in_and_ends_live_sessions(client, session, world, superadmin_headers):
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    assert client.get(f"{ACC}/me", headers=world["manager_a"]).status_code == 200
    res = client.post(f"{COOP}/accounts/{manager.id}/status", json={"status": "SUSPENDED", "reason": "Investigation"}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["account_status"] == "SUSPENDED"
    assert client.get(f"{ACC}/me", headers=world["manager_a"]).status_code == 401
    blocked = login(client, "manager@a.coop", PASSWORD)
    assert blocked.status_code == 403 and "suspended" in blocked.json()["detail"]
    res = client.post(f"{COOP}/accounts/{manager.id}/status", json={"status": "ACTIVE"}, headers=world["admin_a"])
    assert res.json()["account_status"] == "ACTIVE"
    assert login(client, "manager@a.coop", PASSWORD).status_code == 200
    events = {a.action for a in session.query(AuditLog).filter_by(entity_type="security").all()}
    assert {"ACCOUNT_SUSPENDED", "ACCOUNT_REACTIVATED", "LOGIN_BLOCKED"} <= events


def test_forced_password_change_is_enforced_by_the_server(client, session, world):
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    manager.must_change_password = True
    session.commit()
    h = bearer(login(client, "manager@a.coop", PASSWORD))
    assert client.get(f"{COOP}/overview", headers=h).status_code == 403
    assert client.get(f"{ACC}/preferences", headers=h).status_code == 403
    assert client.get(f"{ACC}/me", headers=h).json()["must_change_password"] is True
    res = client.post(f"{ACC}/password", json={"current_password": PASSWORD, "new_password": "Brand#New2026"}, headers=h)
    client.cookies.clear()
    assert res.status_code == 200
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert client.get(f"{COOP}/overview", headers=fresh).status_code == 200
    assert client.get(f"{COOP}/overview", headers=h).status_code == 401  # the old token died with the change
    assert login(client, "manager@a.coop", PASSWORD).status_code == 401


def test_password_change_rules_and_reuse(client, world):
    h = world["manager_a"]
    assert client.post(f"{ACC}/password", json={"current_password": "Wrong#1x", "new_password": "Brand#New2026"}, headers=h).status_code == 400
    assert client.post(f"{ACC}/password", json={"current_password": PASSWORD, "new_password": PASSWORD}, headers=h).status_code == 422
    assert client.post(f"{ACC}/password", json={"current_password": PASSWORD, "new_password": "short"}, headers=h).status_code == 422


def test_password_reset_is_separate_from_activation(client, session, world):
    # Self-service reset for an active account: generic answer, link by SMS, single use, expires.
    generic = client.post(f"{AUTH}/password-reset/request", json={"identifier": "0700000012"}).json()
    assert generic == client.post(f"{AUTH}/password-reset/request", json={"identifier": "0799999999"}).json()
    token = world["sms"].token_for("+254700000012")
    assert client.post(f"{AUTH}/password-reset/inspect", json={"token": token}).json()["state"] == "VALID"
    # A reset token is not an activation token (and vice versa).
    assert client.post(f"{AUTH}/activation/inspect", json={"token": token}).json()["state"] == "INVALID"
    assert client.post(f"{AUTH}/password-reset/complete", json={"token": token, "password": "Reset#Pass2026"}).status_code == 200
    assert client.post(f"{AUTH}/password-reset/complete", json={"token": token, "password": "Again#Pass2026"}).status_code == 410
    assert login(client, "manager@a.coop", "Reset#Pass2026").status_code == 200
    # The old session is gone.
    assert client.get(f"{ACC}/me", headers=world["manager_a"]).status_code == 401

    # Expired reset links fail.
    client.post(f"{AUTH}/password-reset/request", json={"identifier": "admin@a.coop"})
    session.query(PasswordReset).filter(PasswordReset.used_at.is_(None)).update(
        {PasswordReset.expires_at: datetime.datetime.utcnow() - datetime.timedelta(minutes=1)})
    session.commit()
    expired = world["sms"].token_for("+254700000011")
    assert client.post(f"{AUTH}/password-reset/inspect", json={"token": expired}).json() == {"state": "EXPIRED"}
    assert client.post(f"{AUTH}/password-reset/complete", json={"token": expired, "password": "Reset#Pass2026"}).status_code == 410

    # A pending account gets nothing from the reset flow (it must activate instead).
    invite_collector(client, world)
    sent_before = len(world["sms"].messages_to(NEW_PHONE))
    client.post(f"{AUTH}/password-reset/request", json={"identifier": NEW_PHONE})
    assert len(world["sms"].messages_to(NEW_PHONE)) == sent_before


def test_admins_can_not_reset_other_admins(client, session, world, superadmin_headers):
    admin_b = session.query(User).filter_by(email="admin@b.coop").one()
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    # Another cooperative's account looks missing; a fellow admin is off limits; a manager can't do it at all.
    assert client.post(f"{COOP}/accounts/{admin_b.id}/send-password-reset", headers=world["admin_a"]).status_code == 404
    admin_a = session.query(User).filter_by(email="admin@a.coop").one()
    assert client.post(f"{COOP}/accounts/{admin_a.id}/send-password-reset", headers=world["admin_a"]).status_code == 403
    assert client.post(f"{COOP}/accounts/{manager.id}/send-password-reset", headers=world["manager_a"]).status_code == 403
    # Platform staff send a link; they never set the password.
    res = client.post(f"{SA}/users/{manager.id}/reset-password", json={"password": "Chosen#ByAdmin1"}, headers=superadmin_headers)
    assert res.status_code == 200 and res.json()["sms_sent"] is True
    assert login(client, "manager@a.coop", "Chosen#ByAdmin1").status_code == 401


# ---------------- sessions ----------------

def test_sign_out_other_sessions(client, session, world):
    phone_a = bearer(login(client, "manager@a.coop", PASSWORD))
    laptop = bearer(login(client, "manager@a.coop", PASSWORD))
    res = client.post(f"{ACC}/sessions/revoke-others", json={}, headers=laptop)
    client.cookies.clear()
    assert res.status_code == 200
    assert client.get(f"{ACC}/me", headers=phone_a).status_code == 401
    assert client.get(f"{ACC}/me", headers=laptop).status_code == 401  # replaced by the returned token
    assert client.get(f"{ACC}/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"}).status_code == 200
    assert session.query(AuditLog).filter_by(action="SESSIONS_REVOKED").count() == 1


def test_device_sessions_list_and_revoke(client, session, world):
    h = world["manager_a"]
    reg = client.post("/api/v1/devices/register", json={"device_identifier": "11111111-1111-4111-8111-111111111111", "platform": "Android"}, headers=h)
    assert reg.status_code == 200, reg.text
    sessions = client.get(f"{ACC}/sessions?device_identifier=11111111-1111-4111-8111-111111111111", headers=h).json()
    assert len(sessions) == 1 and sessions[0]["current"] is True and sessions[0]["platform"] == "Android"
    res = client.delete(f"{ACC}/sessions/{sessions[0]['id']}", headers=h)
    client.cookies.clear()
    assert res.status_code == 200
    token = reg.json()["offline_session"]["token"]
    refreshed = client.post("/api/v1/devices/session/refresh", json={"device_identifier": "11111111-1111-4111-8111-111111111111", "session_token": token})
    assert refreshed.status_code == 401


# ---------------- phone change ----------------

def test_phone_change_needs_a_code_on_the_new_number(client, session, world):
    h = world["manager_a"]
    assert client.post(f"{ACC}/phone/change", json={"phone": "0722 555 666", "password": "Wrong#1x"}, headers=h).status_code == 400
    assert client.post(f"{ACC}/phone/change", json={"phone": "0700000011", "password": PASSWORD}, headers=h).status_code == 409
    res = client.post(f"{ACC}/phone/change", json={"phone": "0722 555 666", "password": PASSWORD}, headers=h)
    assert res.status_code == 200 and res.json()["sms_sent"] is True and res.json()["phone_masked"] == "0722••••66"
    manager = session.query(User).filter_by(email="manager@a.coop").one()
    assert manager.phone_number == "+254700000012"  # unchanged until confirmed
    bad = client.post(f"{ACC}/phone/confirm", json={"verification_id": res.json()["verification_id"], "code": "123456"}, headers=h)
    assert bad.status_code == 400
    code = world["sms"].code_for("+254722555666")
    ok = client.post(f"{ACC}/phone/confirm", json={"verification_id": res.json()["verification_id"], "code": code}, headers=h)
    client.cookies.clear()
    assert ok.status_code == 200 and ok.json()["phone"] == "+254722555666" and ok.json()["phone_verified"] is True
    # The old number is told; the new number signs in.
    assert any("was changed" in m for m in world["sms"].messages_to("+254700000012"))
    assert client.post(f"{AUTH}/login", json={"identifier": "0722555666", "password": PASSWORD}).status_code == 200
    client.cookies.clear()
    assert session.query(AuditLog).filter_by(action="PHONE_CHANGED").count() == 1


def test_admin_phone_change_leaves_the_number_unverified(client, session, world):
    member = invite_collector(client, world)
    activate(client, world["sms"], NEW_PHONE, PASSWORD)
    res = client.patch(f"{COOP}/team/{member['id']}", json={"phone": "0744 000 111"}, headers=world["admin_a"])
    assert res.status_code == 200 and res.json()["phone_verified"] is False


# ---------------- two-step verification ----------------

def test_mfa_enrolment_and_sign_in(client, session, world):
    h = world["manager_a"]
    setup = client.post(f"{ACC}/mfa/setup", json={"password": PASSWORD}, headers=h).json()
    secret = setup["secret"]
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert secret not in (session.query(User).filter_by(email="manager@a.coop").one().mfa_secret_encrypted or "")
    assert client.post(f"{ACC}/mfa/enable", json={"code": "000000"}, headers=h).status_code == 400
    enabled = client.post(f"{ACC}/mfa/enable", json={"code": mfa.totp(secret)}, headers=h).json()
    codes = enabled["recovery_codes"]
    assert len(codes) == 8

    first = login(client, "manager@a.coop", PASSWORD).json()
    assert first["mfa_required"] is True and "access_token" not in first
    assert client.post(f"{AUTH}/mfa/verify", json={"mfa_token": first["mfa_token"], "code": "000000"}).status_code == 400
    ok = client.post(f"{AUTH}/mfa/verify", json={"mfa_token": first["mfa_token"], "code": mfa.totp(secret)})
    client.cookies.clear()
    assert ok.status_code == 200 and ok.json()["access_token"]
    # A recovery code works exactly once.
    second = login(client, "manager@a.coop", PASSWORD).json()
    assert client.post(f"{AUTH}/mfa/verify", json={"mfa_token": second["mfa_token"], "code": codes[0]}).status_code == 200
    client.cookies.clear()
    third = login(client, "manager@a.coop", PASSWORD).json()
    assert client.post(f"{AUTH}/mfa/verify", json={"mfa_token": third["mfa_token"], "code": codes[0]}).status_code == 400
    # The mfa token is not an access token.
    assert client.get(f"{ACC}/me", headers={"Authorization": f"Bearer {third['mfa_token']}"}).status_code == 401


# ---------------- role-scoped settings & permissions ----------------

def test_settings_endpoints_respect_roles(client, session, world, superadmin_headers):
    make_user(session, world["a"], UserRole.COLLECTOR, "col@a.coop", "+254700000013")
    make_user(session, world["a"], UserRole.FARMER, "farmer@a.coop", "+254700000014")
    collector, farmer = headers_for(client, "col@a.coop"), headers_for(client, "farmer@a.coop")
    # Everyone has personal settings...
    for h in (collector, farmer, world["manager_a"], superadmin_headers):
        assert client.get(f"{ACC}/me", headers=h).status_code == 200
        assert client.get(f"{ACC}/preferences", headers=h).status_code == 200
    # ...but not each other's administration.
    assert client.get(f"{COOP}/team", headers=farmer).status_code == 403            # farmer -> manager area
    assert client.get(f"{COOP}/overview", headers=collector).status_code == 403     # collector -> cooperative settings
    assert client.get(f"{COOP}/sms-credits", headers=collector).status_code == 403
    assert client.get(f"{SA}/settings", headers=world["manager_a"]).status_code == 403  # manager -> superadmin
    assert client.put(f"{SA}/settings", headers=world["admin_a"], json={"values": {}}).status_code == 403
    # Nobody can slip a role or cooperative into their own profile.
    assert client.patch(f"{ACC}/profile", json={"role": "COOP_ADMIN"}, headers=world["manager_a"]).status_code == 422
    assert client.patch(f"{ACC}/profile", json={"cooperative_id": str(world["b"].id)}, headers=farmer).status_code == 422
    assert client.patch(f"{ACC}/profile", json={"full_name": "Renamed Farmer"}, headers=farmer).status_code == 403
    assert client.patch(f"{ACC}/profile", json={"full_name": "Paul Renamed"}, headers=collector).json()["full_name"] == "Paul Renamed"


def test_notification_preferences_are_per_role_and_security_is_mandatory(client, session, world):
    make_user(session, world["a"], UserRole.FARMER, "farmer@a.coop", "+254700000014")
    farmer = headers_for(client, "farmer@a.coop")
    keys = {n["key"] for n in client.get(f"{ACC}/preferences", headers=farmer).json()["notifications"]}
    assert "collection_receipts" in keys and "cooler_alerts" not in keys
    assert client.put(f"{ACC}/preferences", json={"notifications": {"security": False}}, headers=farmer).status_code == 422
    assert client.put(f"{ACC}/preferences", json={"notifications": {"cooler_alerts": False}}, headers=farmer).status_code == 422
    res = client.put(f"{ACC}/preferences", json={"notifications": {"payments": False}, "work": {"dashboard_range": "30d"}}, headers=farmer)
    assert res.status_code == 200 and res.json()["work"]["dashboard_range"] == "30d"
    # A default centre must be one of the caller's own cooperative.
    centre_b = client.post(f"{COOP}/centres", json={"name": "B Centre", "county": "Kiambu"}, headers=world["admin_b"]).json()
    bad = client.put(f"{ACC}/preferences", json={"work": {"default_centre_id": centre_b["id"]}}, headers=world["manager_a"])
    assert bad.status_code == 422


def test_cooperative_admins_only_manage_their_own_accounts(client, session, world):
    member = invite_collector(client, world)
    for path in ("resend-activation", "revoke-invitation", "send-password-reset"):
        assert client.post(f"{COOP}/accounts/{member['id']}/{path}", headers=world["admin_b"]).status_code == 404
    assert client.post(f"{COOP}/accounts/{member['id']}/status", json={"status": "DISABLED"}, headers=world["admin_b"]).status_code == 404
    listed = [a["id"] for a in client.get(f"{COOP}/accounts", headers=world["admin_b"]).json()]
    assert member["id"] not in listed


def test_farmer_app_account_from_the_member_register(client, session, world):
    farmer = client.post(f"{COOP}/farmers", json={"first_name": "Jane", "last_name": "Wanjiku", "phone": "0712 345 678"}, headers=world["admin_a"]).json()
    # Managers can't create accounts; the admin can, once.
    assert client.post(f"{COOP}/farmers/{farmer['id']}/account", headers=world["manager_a"]).status_code == 403
    res = client.post(f"{COOP}/farmers/{farmer['id']}/account", headers=world["admin_a"])
    assert res.status_code == 201 and res.json()["role"] == "FARMER" and res.json()["account_status"] == "PENDING_ACTIVATION"
    assert client.post(f"{COOP}/farmers/{farmer['id']}/account", headers=world["admin_a"]).status_code == 409
    activate(client, world["sms"], "+254712345678", PASSWORD)
    h = bearer(client.post(f"{AUTH}/login", json={"identifier": "0712345678", "password": PASSWORD}))
    client.cookies.clear()
    dash = client.get("/api/v1/farmer/dashboard?range=30d", headers=h)
    assert dash.status_code == 200 and dash.json()["farmer"]["farmer_number"] == farmer["farmer_number"]
    me = client.get(f"{ACC}/me", headers=h).json()
    assert me["profile"]["farmer_number"] == farmer["farmer_number"] and me["editable"]["full_name"] is False


def test_no_secret_is_ever_written_to_the_audit_trail(client, session, world):
    invite_collector(client, world)
    token = activate(client, world["sms"], NEW_PHONE, "Paul#Own2026")
    client.post(f"{AUTH}/password-reset/request", json={"identifier": NEW_PHONE})
    reset = world["sms"].token_for(NEW_PHONE)
    client.post(f"{AUTH}/password-reset/complete", json={"token": reset, "password": "Paul#New2026"})
    dump = json.dumps([[a.target, a.new_values, a.old_values] for a in session.query(AuditLog).all()], default=str)
    for secret in (token, reset, "Paul#Own2026", "Paul#New2026", world["sms"].code_for(NEW_PHONE)):
        assert secret not in dump
    stored = json.dumps([n.message for n in session.query(Notification).all()])
    assert token not in stored and reset not in stored


def test_application_status_needs_reference_and_email(client):
    res = client.post("/api/v1/auth/register", json={
        "cooperative_name": "Status Co-op", "registration_number": "CS/555", "kra_pin": "P000000555A",
        "county": "Nakuru", "location": "Njoro", "admin_full_name": "Ann Admin",
        "admin_email": "ann@example.com", "admin_phone": "0700111555", "admin_id_number": "1234567",
        "password": "Passw0rdX",
    })
    reference = res.json()["application_id"]
    ok = client.post(f"{AUTH}/application-status", json={"reference": reference, "email": "ANN@example.com"})
    assert ok.status_code == 200 and ok.json()["status"] == "PENDING" and ok.json()["rejection_reason"] is None
    assert set(ok.json()) == {"status", "organisation", "submitted_at", "reviewed_at", "rejection_reason"}
    wrong = client.post(f"{AUTH}/application-status", json={"reference": reference, "email": "someone@else.com"})
    missing = client.post(f"{AUTH}/application-status", json={"reference": "00000000-0000-0000-0000-000000000000", "email": "ann@example.com"})
    assert wrong.status_code == missing.status_code == 404 and wrong.json() == missing.json()
