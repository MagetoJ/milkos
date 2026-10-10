"""lib/permissions.json is the frontend's copy of the role/permission table. It must never drift from the backend."""
import json
from pathlib import Path

from core.permissions import ROLE_PERMISSIONS

MIRROR = Path(__file__).resolve().parents[2] / "lib" / "permissions.json"


def test_frontend_permission_table_matches_backend():
    mirror = json.loads(MIRROR.read_text(encoding="utf-8"))
    backend = {str(getattr(role, "value", role)): sorted(p.value for p in perms) for role, perms in ROLE_PERMISSIONS.items()}
    assert mirror == backend, "Regenerate lib/permissions.json from core.permissions.ROLE_PERMISSIONS"
