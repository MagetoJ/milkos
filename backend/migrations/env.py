from logging.config import fileConfig

from alembic import context

# db.py loads backend/.env and builds the engine from DATABASE_URL (an already-set
# environment variable wins, which is how the tests point this at SQLite).
import db
import models  # noqa: F401  (registers every table on Base.metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = db.Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # Tables that exist in the database but have no model yet (milk_collections,
    # sms_credit_packages) must never show up as "drop table" in an autogenerate.
    if type_ == "table" and reflected and compare_to is None:
        return False
    return True


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
