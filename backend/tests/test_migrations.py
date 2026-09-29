"""7. The API starts on an empty database after running the migrations (and not before)."""
import os
import subprocess
import sys
import textwrap
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run(code_or_args, db_url):
    env = {**os.environ, "DATABASE_URL": db_url}
    args = code_or_args if isinstance(code_or_args, list) else ["-c", textwrap.dedent(code_or_args)]
    return subprocess.run([sys.executable, *args], cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120)


SMOKE = """
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app) as c:
        assert c.get("/openapi.json").status_code == 200
        r = c.post("/api/v1/auth/register", json={
            "cooperative_name": "Fresh DB Co-op", "registration_number": "CS/1", "kra_pin": "P000000001A",
            "county": "Nakuru", "location": "Njoro", "admin_full_name": "Ann Admin",
            "admin_email": "ann@example.com", "admin_phone": "0700111222", "admin_id_number": "1234567",
            "password": "Passw0rdX",
        })
        assert r.status_code == 201, r.text
    print("OK")
"""


def test_api_starts_on_empty_database_after_migrations(tmp_path):
    url = f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    migrate = run(["-m", "alembic", "upgrade", "head"], url)
    assert migrate.returncode == 0, migrate.stderr
    smoke = run(SMOKE, url)
    assert smoke.returncode == 0, smoke.stderr
    assert smoke.stdout.strip().endswith("OK")


def test_startup_does_not_create_tables(tmp_path):
    """The app must not silently create_all(): without migrations the tables don't exist."""
    url = f"sqlite:///{(tmp_path / 'unmigrated.db').as_posix()}"
    code = """
        import main, db
        from sqlalchemy import inspect
        print(inspect(db.engine).get_table_names())
    """
    res = run(code, url)
    assert res.returncode == 0, res.stderr
    assert res.stdout.strip() == "[]"


def test_downgrade_to_baseline_and_back(tmp_path):
    url = f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}"
    for step in (["upgrade", "head"], ["downgrade", "0001_baseline"], ["upgrade", "head"]):
        res = run(["-m", "alembic", *step], url)
        assert res.returncode == 0, res.stderr
