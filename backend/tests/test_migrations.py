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


SEED_0004 = """
    import sqlite3, sys, uuid
    c = sqlite3.connect(sys.argv[1])
    coop, user = uuid.uuid4().hex, uuid.uuid4().hex
    c.execute("INSERT INTO cooperatives (id, name, code, registration_number, kra_pin, county, status, sms_credit_balance)"
              " VALUES (?, 'C', 'C-1', 'CS/1', 'P000000001A', 'Kiambu', 'ACTIVE', 0)", (coop,))
    c.execute("INSERT INTO users (id, email, password_hash, full_name, phone_number, role, cooperative_id, is_active)"
              " VALUES (?, 'c@x.ke', 'h', 'Col', '+254700000001', 'COLLECTOR', ?, 1)", (user, coop))
    for name in ("K1", "K2"):
        c.execute("INSERT INTO coolers (id, cooperative_id, name, is_operational) VALUES (?, ?, ?, 1)", (uuid.uuid4().hex, coop, name))
    c.execute("INSERT INTO audit_logs (id, admin_id, action, target) VALUES (?, ?, 'X', 'y')", (uuid.uuid4().hex, user))
    c.commit()
"""

CHECK_0005 = """
    import sqlite3, sys
    c = sqlite3.connect(sys.argv[1])
    print(sorted(r[0] for r in c.execute("SELECT code FROM coolers")))
    print(c.execute("SELECT collector_number, status FROM collectors").fetchall())
    print(c.execute("SELECT COUNT(*) FROM users WHERE cooperative_id IS NOT NULL").fetchone()[0])
    print(c.execute("SELECT actor_email FROM audit_logs").fetchall())
"""


def test_0005_keeps_and_backfills_existing_rows(tmp_path):
    """Rebuilding tables in SQLite batch mode must not fire ON DELETE rules (it used to wipe coolers)."""
    path = (tmp_path / "data.db").as_posix()
    url = f"sqlite:///{path}"
    assert run(["-m", "alembic", "upgrade", "0004_cooperative_uniques"], url).returncode == 0
    seed = run(["-c", textwrap.dedent(SEED_0004), path], url)
    assert seed.returncode == 0, seed.stderr
    upgrade = run(["-m", "alembic", "upgrade", "head"], url)
    assert upgrade.returncode == 0, upgrade.stderr
    check = run(["-c", textwrap.dedent(CHECK_0005), path], url)
    assert check.stdout.split("\n")[:4] == [
        "['CLR-001', 'CLR-002']", "[('COL-001', 'ACTIVE')]", "1", "[('c@x.ke',)]",
    ], check.stdout + check.stderr
    for step in (["downgrade", "-1"], ["upgrade", "head"]):
        res = run(["-m", "alembic", *step], url)
        assert res.returncode == 0, res.stderr


SEED_0005 = """
    import sqlite3, sys, uuid
    c = sqlite3.connect(sys.argv[1])
    coop = uuid.uuid4().hex
    c.execute("INSERT INTO cooperatives (id, name, code, registration_number, kra_pin, county, status, sms_credit_balance)"
              " VALUES (?, 'C', 'C-1', 'CS/1', 'P000000001A', 'Kiambu', 'ACTIVE', 0)", (coop,))
    c.execute("INSERT INTO farmers (id, cooperative_id, farmer_number, first_name, last_name, phone, status)"
              " VALUES (?, ?, 'F-0001', 'Jane', 'W', '+254712345678', 'ACTIVE')", (uuid.uuid4().hex, coop))
    c.commit()
"""

CHECK_0006 = """
    import sqlite3, sys
    c = sqlite3.connect(sys.argv[1])
    print(sorted(r[0] for r in c.execute("SELECT entity_type FROM sync_changes")))
    print(c.execute("SELECT sync_version FROM farmers").fetchall())
"""


def test_0006_backfills_the_change_log(tmp_path):
    """Records that existed before offline sync must reach a device's first pull."""
    path = (tmp_path / "data.db").as_posix()
    url = f"sqlite:///{path}"
    assert run(["-m", "alembic", "upgrade", "0005_platform_admin"], url).returncode == 0
    seed = run(["-c", textwrap.dedent(SEED_0005), path], url)
    assert seed.returncode == 0, seed.stderr
    upgrade = run(["-m", "alembic", "upgrade", "head"], url)
    assert upgrade.returncode == 0, upgrade.stderr
    check = run(["-c", textwrap.dedent(CHECK_0006), path], url)
    assert check.stdout.split("\n")[:2] == ["['cooperative', 'farmer']", "[(1,)]"], check.stdout + check.stderr
    for step in (["downgrade", "-1"], ["upgrade", "head"]):
        res = run(["-m", "alembic", *step], url)
        assert res.returncode == 0, res.stderr
