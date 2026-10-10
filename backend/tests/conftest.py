"""
Tests run against a throwaway SQLite database built by the real Alembic migrations.

DATABASE_URL is set here, before anything imports `db`, so the tests can never reach Supabase
(db.py's load_dotenv() does not override a variable that is already set).
"""
import os
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
_TMP = Path(tempfile.mkdtemp(prefix="milkos-tests-"))
# Opt-in: run the suite against a THROWAWAY local Postgres (its tables are emptied after every test), e.g.
#   MILKOS_TEST_POSTGRES_URL=postgresql+psycopg://postgres:test@127.0.0.1:55432/milkos_test
_PG = os.environ.get("MILKOS_TEST_POSTGRES_URL", "")
if _PG:
    from urllib.parse import urlparse

    assert urlparse(_PG).hostname in ("127.0.0.1", "localhost"), "MILKOS_TEST_POSTGRES_URL must be a local throwaway database"
os.environ["DATABASE_URL"] = _PG or f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-key")
# Fast password hashing for tests only (production keeps bcrypt's default cost).
os.environ.setdefault("BCRYPT_ROUNDS", "4")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

import db  # noqa: E402

assert db.engine.dialect.name == "sqlite" or (_PG and db.engine.url.host in ("127.0.0.1", "localhost")), \
    "tests must never run against a real database"


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables(migrated_database):
    from core import ratelimit

    ratelimit.reset()
    yield
    with db.engine.begin() as conn:
        for table in reversed(db.Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def session():
    s = db.SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as c:
        yield c


SUPERADMIN_EMAIL = "root@milkflow.co.ke"
SUPERADMIN_PASSWORD = "SuperAdmin#2026"


@pytest.fixture
def superadmin_headers(client, session):
    from core.security import hash_password
    from models.user import User
    from schemas.auth import UserRole

    session.add(User(
        email=SUPERADMIN_EMAIL, password_hash=hash_password(SUPERADMIN_PASSWORD), full_name="Root",
        phone_number="+254700000000", role=UserRole.SUPER_ADMIN, is_active=True,
    ))
    session.commit()
    return {"Authorization": f"Bearer {login(client, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD).json()['access_token']}"}


def login(client, email, password):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    # The API prefers the cookie over the Authorization header; don't let one user's cookie
    # leak into the next request made on the shared client.
    client.cookies.clear()
    return res


# ---------------- SMS outbox and account activation helpers ----------------

class RecordingSms:
    """An SMS provider that accepts everything and keeps the messages, so tests can read activation links and codes."""
    name = "recording"

    def __init__(self, accept=True):
        self.sent = []
        self.accept = accept

    def send_sms(self, to, message):
        from services.sms import SmsResult

        if not self.accept:
            return SmsResult(False, error="Simulated provider refusal", retryable=True)
        self.sent.append((to, message))
        return SmsResult(True, provider_message_id=f"msg-{len(self.sent)}")

    def messages_to(self, phone):
        return [m for to, m in self.sent if to == phone]

    def token_for(self, phone):
        import re

        for message in reversed(self.messages_to(phone)):
            found = re.search(r"#t=([A-Za-z0-9_\-]+)", message)
            if found:
                return found.group(1)
        raise AssertionError(f"no link sent to {phone}")

    def code_for(self, phone):
        import re

        for message in reversed(self.messages_to(phone)):
            found = re.search(r"code: (\d{6})", message)
            if found:
                return found.group(1)
        raise AssertionError(f"no code sent to {phone}")


@pytest.fixture
def sms_outbox():
    from services import sms

    box = RecordingSms()
    sms.set_provider(box)
    yield box
    sms.reset_provider()


def fund(session, cooperative_id, credits=100):
    """Give a cooperative SMS credits through the ledger (activation SMS from cooperative staff cost one)."""
    import uuid as _uuid

    from services import sms_credits

    sms_credits.adjust(session, cooperative_id, credits, "test credits", None, f"test:{_uuid.uuid4()}")
    session.commit()


def activate(client, outbox, phone, password="Fresh#Pass9"):
    """Walk the public activation flow for the account the last activation SMS to `phone` was for."""
    token = outbox.token_for(phone)
    page = client.post("/api/v1/auth/activation/inspect", json={"token": token}).json()
    assert page["state"] == "VALID", page
    if page["requires_otp"]:
        assert client.post("/api/v1/auth/activation/send-code", json={"token": token}).json()["sms_sent"] is True
        res = client.post("/api/v1/auth/activation/verify-code", json={"token": token, "code": outbox.code_for(phone)})
        assert res.status_code == 200, res.text
    res = client.post("/api/v1/auth/activation/complete", json={"token": token, "password": password})
    assert res.status_code == 200, res.text
    return token
