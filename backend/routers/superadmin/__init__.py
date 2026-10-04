"""Platform administration API: /api/v1/superadmin/*.

`require_superadmin` is applied to the whole router, so every endpoint below is closed to anyone who
is not an active SUPER_ADMIN (checked against the database on every request), even one that forgets
to declare it. Handlers that need the caller also depend on it; FastAPI resolves it once per request.
"""
from fastapi import APIRouter, Depends

from core.access import require_superadmin
from routers.superadmin import (
    applications,
    audit,
    collections,
    collectors,
    coolers,
    cooperatives,
    dashboard,
    farmers,
    payments,
    reports,
    settings,
    sync,
    users,
)

router = APIRouter(prefix="/api/v1/superadmin", tags=["Super Admin"], dependencies=[Depends(require_superadmin)])

for module in (
    dashboard, applications, cooperatives, users, farmers, collectors, coolers, collections, payments,
    reports, audit, settings, sync,
):
    router.include_router(module.router)
