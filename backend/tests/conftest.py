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
