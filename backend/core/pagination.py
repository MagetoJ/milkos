"""Pagination and sorting for list endpoints.

List endpoints return {"items", "total", "page", "page_size", "pages"} and accept
`page`, `page_size` (max 100) and `sort` ("field" ascending, "-field" descending, from a whitelist).
"""
import math
from dataclasses import dataclass
from typing import Any, Callable, Optional

from fastapi import HTTPException, Query

@dataclass
class PageParams:
    page: int
    page_size: int
    sort: Optional[str]

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=100),
    sort: Optional[str] = Query(None, max_length=50, pattern=r"^-?[a-z_]+$"),
) -> PageParams:
    return PageParams(page=page, page_size=page_size, sort=sort)


def apply_sort(query, sort: Optional[str], columns: dict[str, Any], default: list):
    """Order by a whitelisted column; ties (and no sort) fall back to `default`."""
    if not sort:
        return query.order_by(*default)
    descending = sort.startswith("-")
    name = sort.lstrip("-")
    column = columns.get(name)
    if column is None:
        raise HTTPException(422, f"Can't sort by '{name}'. Use one of: {', '.join(sorted(columns))}.")
    return query.order_by(column.desc() if descending else column.asc(), *default)


def fetch_page(query, params: PageParams) -> tuple[list, int]:
    """(rows on this page, total matching). `query` must already be filtered and ordered."""
    total = query.order_by(None).count()
    return query.offset(params.offset).limit(params.page_size).all(), total


def page_result(items: list, total: int, params: PageParams) -> dict:
    return {
        "items": items,
        "total": total,
        "page": params.page,
        "page_size": params.page_size,
        "pages": max(1, math.ceil(total / params.page_size)) if total else 1,
    }


def paginate(query, params: PageParams, serialize: Callable[[Any], Any]) -> dict:
    """Count, slice and serialise in one step."""
    rows, total = fetch_page(query, params)
    return page_result([serialize(row) for row in rows], total, params)
