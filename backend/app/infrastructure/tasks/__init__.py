"""Task dispatch: implementations of app.domain.interfaces.TaskDispatcher, and the registry of task handlers.

A task is a function `handler(db, payload)` registered by name with @task("name") (see app/services/background.py).
It runs with its own database session, after the response has been sent:

    BackgroundTaskDispatcher   in the API process, after the response (FastAPI BackgroundTasks). The default.
    InlineDispatcher           immediately, in the caller's thread (tests, scripts).

To move tasks to a worker queue (Celery + Redis), add a dispatcher whose enqueue() sends (task, payload) to the
broker, and a worker that calls run(task, payload). Callers don't change: they only see TaskDispatcher.
"""
import json
import logging
from typing import Any, Callable, Mapping

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.infrastructure.db.database import SessionLocal

logger = logging.getLogger("milkos.tasks")

Handler = Callable[[Session, Mapping[str, Any]], None]
_registry: dict[str, Handler] = {}


def task(name: str) -> Callable[[Handler], Handler]:
    """Register `handler` as the task `name`."""

    def register(handler: Handler) -> Handler:
        if name in _registry and _registry[name] is not handler:
            raise ValueError(f"Task '{name}' is already registered")
        _registry[name] = handler
        return handler

    return register


def _validated(name: str, payload: Mapping[str, Any]) -> dict:
    """Fail at the call site, not later in a worker: the task must exist and the payload must survive a queue."""
    if name not in _registry:
        raise KeyError(f"Unknown task '{name}'")
    payload = dict(payload)
    json.dumps(payload)  # TypeError for anything that isn't plain data
    return payload


def run(name: str, payload: Mapping[str, Any]) -> None:
    """Run one task in a fresh session. Errors are logged, never raised: the response has already gone."""
    db = SessionLocal()
    try:
        _registry[name](db, payload)
    except Exception:
        db.rollback()
        logger.exception("task_failed task=%s", name)
    finally:
        db.close()


class BackgroundTaskDispatcher:
    def __init__(self, background_tasks: BackgroundTasks):
        self._background_tasks = background_tasks

    def enqueue(self, task: str, payload: Mapping[str, Any]) -> None:
        self._background_tasks.add_task(run, task, _validated(task, payload))


class InlineDispatcher:
    def enqueue(self, task: str, payload: Mapping[str, Any]) -> None:
        run(task, _validated(task, payload))
