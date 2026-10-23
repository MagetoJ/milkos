"""Work that runs after the response: SMS receipts, analytics rollups.

The first implementation runs tasks in-process (FastAPI BackgroundTasks); a Celery/Redis one can replace it
without touching callers, which is why the payload rule below matters.
"""
from typing import Any, Mapping, Protocol


class TaskDispatcher(Protocol):
    def enqueue(self, task: str, payload: Mapping[str, Any]) -> None:
        """Schedule the task registered as `task`.

        `payload` must be JSON-serialisable: ids and plain values, never ORM objects or sessions. The task
        opens its own session and re-reads what it needs, because it may run in another process, later.

        A task must be safe to run twice. Delivery state lives in the database (e.g. the notifications
        outbox), so a lost task is picked up by the next dispatch_due rather than lost.
        """
        ...
