"""The database session for one request. Routers depend on this, never on the engine."""
from typing import Iterator

from sqlalchemy.orm import Session

from app.infrastructure.db.database import SessionLocal


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
