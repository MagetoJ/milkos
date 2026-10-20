"""Data-access contracts.

Entities are the SQLAlchemy models in `models/` for now. Keeping a second, ORM-free copy of every entity would
double the code for no present benefit; the boundary that matters is that services reach the database through
these interfaces, so queries live in one place and every read is tenant-scoped.
"""
from typing import Optional, Protocol, TypeVar
from uuid import UUID

T = TypeVar("T")


class Repository(Protocol[T]):
    """Platform-wide records (users, cooperatives, platform settings)."""

    def get(self, id: UUID) -> Optional[T]: ...

    def add(self, entity: T) -> T: ...


class TenantScopedRepository(Protocol[T]):
    """Records that belong to one cooperative. Every read takes the cooperative, so cross-tenant access can't
    happen by forgetting a filter; a row of another cooperative is simply not found."""

    def get(self, cooperative_id: UUID, id: UUID) -> Optional[T]: ...

    def add(self, entity: T) -> T: ...


class UnitOfWork(Protocol):
    """One transaction. Services commit through this, not through a session they were handed."""

    def commit(self) -> None: ...

    def rollback(self) -> None: ...
