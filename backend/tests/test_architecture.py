"""The layering rules of app/ (see app/README.md) and the pieces that hold them together: domain errors, the task
dispatcher and tenant-scoped lookups."""
import ast
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.errors import detail_for, register_error_handlers, status_code_for
from app.domain.exceptions import (
    Conflict, NotFound, PermissionDenied, RateLimited, Unauthenticated, ValidationFailed,
)
from app.infrastructure import tasks
from app.infrastructure.db.models.centre import CollectionCentre
from app.services.principal import get_or_404
from tests.test_cooperative_module import make_coop

APP = Path(__file__).resolve().parent.parent / "app"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
    return found


def _modules(*layers: str):
    for layer in layers:
        yield from (APP / layer).rglob("*.py")


# ---------------- layering ----------------

def test_lower_layers_never_import_the_api():
    offenders = [
        str(p.relative_to(APP)) for p in _modules("services", "domain", "infrastructure", "core")
        if any(m == "app.api" or m.startswith("app.api.") for m in _imports(p))
    ]
    assert offenders == []


def test_services_domain_and_infrastructure_are_free_of_fastapi():
    # The in-process task dispatcher is built on FastAPI's BackgroundTasks by design.
    allowed = {"infrastructure/tasks/__init__.py"}
    offenders = [
        str(p.relative_to(APP)).replace("\\", "/") for p in _modules("services", "domain", "infrastructure")
        if any(m == "fastapi" or m.startswith("fastapi.") for m in _imports(p))
    ]
    assert [o for o in offenders if o not in allowed] == []


def test_domain_depends_on_nothing_below_it():
    offenders = [
        str(p.relative_to(APP)) for p in _modules("domain")
        if any(m.startswith(("app.services", "app.infrastructure", "app.api", "sqlalchemy")) for m in _imports(p))
    ]
    assert offenders == []


def test_routers_do_not_touch_the_database():
    pattern = re.compile(r"\bdb\.(query|get|add|delete|commit|rollback|flush|refresh|execute)\(")
    offenders = [
        f"{p.relative_to(APP)}:{n}" for p in (APP / "api" / "routers").rglob("*.py")
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if pattern.search(line)
    ]
    assert offenders == []


# ---------------- domain errors -> HTTP ----------------

def test_domain_errors_keep_the_response_shapes_clients_use():
    assert (status_code_for(Conflict("Already cancelled.")), detail_for(Conflict("Already cancelled."))) == (409, "Already cancelled.")
    assert detail_for(ValidationFailed("Say why.", "rejection_reason")) == [
        {"loc": ["body", "rejection_reason"], "msg": "Say why.", "type": "invalid"}
    ]
    assert detail_for(Conflict("Taken.", "phone")) == [{"loc": ["body", "phone"], "msg": "Taken.", "type": "conflict"}]
    assert detail_for(Conflict("Clash.", loc=["body"])) == [{"loc": ["body"], "msg": "Clash.", "type": "conflict"}]
    assert (status_code_for(NotFound("Farmer")), detail_for(NotFound("Farmer"))) == (404, "Farmer not found")
    assert status_code_for(RateLimited("Slow down.")) == 429


def test_error_handler_sends_the_machine_readable_code_as_a_header():
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/locked")
    def locked():
        raise PermissionDenied("Change your password before continuing.", code="password_change_required")

    @app.get("/expired")
    def expired():
        raise Unauthenticated("Your session has ended.")

    client = TestClient(app)
    res = client.get("/locked")
    assert res.status_code == 403
    assert res.json() == {"detail": "Change your password before continuing."}
    assert res.headers["x-error-code"] == "password_change_required"
    res = client.get("/expired")
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"


# ---------------- task dispatcher ----------------

@pytest.fixture
def recorded_task():
    calls = []

    @tasks.task("tests.record")
    def _record(db, payload):
        calls.append((db is not None, dict(payload)))

    @tasks.task("tests.explode")
    def _explode(db, payload):
        raise RuntimeError("boom")

    yield calls
    tasks._registry.pop("tests.record", None)
    tasks._registry.pop("tests.explode", None)


def test_inline_dispatcher_runs_the_task_with_its_own_session(recorded_task):
    tasks.InlineDispatcher().enqueue("tests.record", {"ids": ["a", "b"]})
    assert recorded_task == [(True, {"ids": ["a", "b"]})]


def test_payloads_must_survive_a_queue(recorded_task):
    with pytest.raises(TypeError):
        tasks.InlineDispatcher().enqueue("tests.record", {"session": object()})
    with pytest.raises(KeyError):
        tasks.InlineDispatcher().enqueue("tests.unknown", {})
    assert recorded_task == []


def test_a_failing_task_never_reaches_the_caller(recorded_task, caplog):
    tasks.InlineDispatcher().enqueue("tests.explode", {})
    assert "task_failed task=tests.explode" in caplog.text


def test_the_real_task_handlers_are_registered():
    from app.services import background

    for name in (background.DELIVER, background.HOUSEKEEPING):
        assert name in tasks._registry


# ---------------- tenant-scoped lookup ----------------

def test_another_cooperatives_row_looks_missing(session):
    a, b = make_coop(session, 1), make_coop(session, 2)
    centre = CollectionCentre(cooperative_id=a.id, name="Kiserian", code="KIS", county="Kajiado")
    session.add(centre)
    session.commit()
    assert get_or_404(session, CollectionCentre, str(centre.id), "Centre", a.id) is centre
    with pytest.raises(NotFound):
        get_or_404(session, CollectionCentre, str(centre.id), "Centre", b.id)
    assert get_or_404(session, CollectionCentre, str(centre.id), "Centre") is centre  # platform scope

