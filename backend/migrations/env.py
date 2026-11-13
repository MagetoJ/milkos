from logging.config import fileConfig

from alembic import context

import app.infrastructure.db.models  # noqa: F401  (registers every table on Base.metadata)

# database.py builds the (synchronous) engine from DATABASE_URL; an already-set environment variable wins,
# which is how the tests point this at SQLite.
from app.infrastructure.db import database as db

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = db.Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # Tables that exist in the database but have no model must never show up as "drop table" in an autogenerate.
    return not (type_ == "table" and reflected and compare_to is None)


def run_migrations_offline() -> None:
    context.configure(
        url=db.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    with db.engine.connect() as connection:
        if connection.dialect.name == "sqlite":
            # Batch mode rebuilds a table by DROP + RENAME; with foreign keys enforced that could cascade-delete rows.
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
