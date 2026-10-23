"""The TaskDispatcher for one request: tasks run after the response has been sent."""
from fastapi import BackgroundTasks

import app.services.background  # noqa: F401  (registers the task handlers)
from app.domain.interfaces import TaskDispatcher
from app.infrastructure.tasks import BackgroundTaskDispatcher


def get_tasks(background_tasks: BackgroundTasks) -> TaskDispatcher:
    return BackgroundTaskDispatcher(background_tasks)
