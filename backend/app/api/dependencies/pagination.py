"""`page`, `page_size` and `sort` query parameters for list endpoints."""
from typing import Optional

from fastapi import Query

from app.infrastructure.db.pagination import PageParams


def page_params(
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=100),
    sort: Optional[str] = Query(None, max_length=50, pattern=r"^-?[a-z_]+$"),
) -> PageParams:
    return PageParams(page=page, page_size=page_size, sort=sort)
