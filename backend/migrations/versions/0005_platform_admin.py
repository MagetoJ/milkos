"""Platform administration: collectors, milk collections, richer coolers/farmers/audit logs, settings.

- cooperatives:       contact details, suspension reason/time, updated_at
- users:              last_login_at, updated_at
- farmers:            number_of_cows, payment details, updated_at
- collection_centres: updated_at
- coolers:            code (backfilled CLR-001...), centre, capacity, status, last reading, updated_at;
                      cooperative_id becomes NOT NULL
- collectors:         new; one profile per existing COLLECTOR user is created (COL-001...)
- milk_collections:   rebuilt. The baseline table pointed at users, had no cooperative/cooler and
                      was never written by the application. It is only replaced when EMPTY.
- audit_logs:         actor role/email, entity, cooperative, old/new values, ip, user agent;
                      the actor FK becomes ON DELETE SET NULL so removing a user keeps history
- sms_credit_payments: rejection_reason, submitted_by
- platform_settings:  new key/value table

Before changing anything it checks the existing data and stops with an explanation if it doesn't fit.

Revision ID: 0005_platform_admin
Revises: 0004_cooperative_uniques
Create Date: 2026-10-03
"""
import datetime
import uuid
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005_platform_admin"
down_revision: Union[str, Sequence[str], None] = "0004_cooperative_uniques"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
NOW = sa.text("CURRENT_TIMESTAMP")


def _check_existing_data() -> None:
    bind = op.get_bind()
    problems = []
    orphan_coolers = bind.execute(sa.text("SELECT COUNT(*) FROM coolers WHERE cooperative_id IS NULL")).scalar()
    if orphan_coolers:
        problems.append(
            f"coolers has {orphan_coolers} row(s) without a cooperative_id; assign or delete them "
            "(every cooler must belong to a cooperative)."
        )
    collections = bind.execute(sa.text("SELECT COUNT(*) FROM milk_collections")).scalar()
    if collections:
        problems.append(
            f"milk_collections has {collections} row(s) in the old baseline format (farmer/collector as users). "
            "They must be migrated by hand to the new structure before this revision can run."
        )
    if problems:
        raise RuntimeError(
            "Migration 0005 stopped before changing anything:\n  - " + "\n  - ".join(problems)
            + "\nFix the data (nothing was modified), then run `alembic upgrade head` again."
        )


def _backfill_cooler_codes() -> None:
    bind = op.get_bind()
    coolers = sa.table(
        "coolers",
        sa.column("id", sa.Uuid()), sa.column("cooperative_id", sa.Uuid()),
        sa.column("code", sa.String()), sa.column("created_at", sa.DateTime()),
    )
    rows = bind.execute(
        sa.select(coolers.c.id, coolers.c.cooperative_id).order_by(coolers.c.cooperative_id, coolers.c.created_at, coolers.c.id)
    ).all()
    seq: dict = {}
    for cooler_id, coop_id in rows:
        seq[coop_id] = seq.get(coop_id, 0) + 1
        bind.execute(coolers.update().where(coolers.c.id == cooler_id).values(code=f"CLR-{seq[coop_id]:03d}"))


def _backfill_collectors() -> None:
    bind = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()), sa.column("cooperative_id", sa.Uuid()), sa.column("role", sa.String()),
        sa.column("is_active", sa.Boolean()), sa.column("created_at", sa.DateTime()),
    )
    collectors = sa.table(
        "collectors",
        sa.column("id", sa.Uuid()), sa.column("user_id", sa.Uuid()), sa.column("cooperative_id", sa.Uuid()),
        sa.column("collector_number", sa.String()), sa.column("status", sa.String()),
        sa.column("created_at", sa.DateTime()), sa.column("updated_at", sa.DateTime()),
    )
    rows = bind.execute(
        sa.select(users.c.id, users.c.cooperative_id, users.c.is_active)
        .where(sa.cast(users.c.role, sa.String()) == "COLLECTOR", users.c.cooperative_id.isnot(None))
        .order_by(users.c.cooperative_id, users.c.created_at, users.c.id)
    ).all()
    seq: dict = {}
    now = datetime.datetime.utcnow()
    for user_id, coop_id, active in rows:
        seq[coop_id] = seq.get(coop_id, 0) + 1
        bind.execute(collectors.insert().values(
            id=uuid.uuid4(), user_id=user_id, cooperative_id=coop_id,
            collector_number=f"COL-{seq[coop_id]:03d}", status="ACTIVE" if active else "INACTIVE",
            created_at=now, updated_at=now,
        ))


def _create_milk_collections(uuid_default) -> None:
    op.create_table(
        "milk_collections",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("reference", sa.String(40), nullable=False),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("farmer_id", sa.Uuid(), nullable=False),
        sa.Column("collector_id", sa.Uuid()),
        sa.Column("cooler_id", sa.Uuid()),
        sa.Column("centre_id", sa.Uuid()),
        sa.Column("collection_date", sa.Date(), nullable=False),
        sa.Column("collection_time", sa.Time(), nullable=False),
        sa.Column("quantity_litres", sa.Numeric(10, 2), nullable=False),
        sa.Column("fat_percentage", sa.Numeric(5, 2)),
        sa.Column("snf_percentage", sa.Numeric(5, 2)),
        sa.Column("temperature_c", sa.Numeric(5, 2)),
        sa.Column("quality_status", sa.String(20), nullable=False, server_default="ACCEPTED"),
        sa.Column("rejection_reason", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("recorded_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="milk_collections_pkey"),
        sa.UniqueConstraint("reference", name="milk_collections_reference_key"),
        sa.CheckConstraint("quantity_litres > 0", name="ck_milk_collections_quantity_positive"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="milk_collections_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["farmer_id"], ["farmers.id"], name="milk_collections_farmer_id_fkey", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["collector_id"], ["collectors.id"], name="milk_collections_collector_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="milk_collections_cooler_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["centre_id"], ["collection_centres.id"], name="milk_collections_centre_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], name="milk_collections_recorded_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_milk_collections_coop_date", "milk_collections", ["cooperative_id", "collection_date"])
    op.create_index("ix_milk_collections_farmer", "milk_collections", ["farmer_id", "collection_date"])
    op.create_index("ix_milk_collections_collector", "milk_collections", ["collector_id"])
    op.create_index("ix_milk_collections_cooler", "milk_collections", ["cooler_id"])


def upgrade() -> None:
    if not context.is_offline_mode():
        _check_existing_data()

    is_pg = context.get_context().dialect.name == "postgresql"
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None

    with op.batch_alter_table("cooperatives") as batch:
        batch.add_column(sa.Column("contact_email", sa.String(255)))
        batch.add_column(sa.Column("contact_phone", sa.String(50)))
        batch.add_column(sa.Column("suspension_reason", sa.Text()))
        batch.add_column(sa.Column("suspended_at", sa.DateTime()))
        batch.add_column(sa.Column("updated_at", sa.DateTime(), server_default=NOW))

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("last_login_at", sa.DateTime()))
        batch.add_column(sa.Column("updated_at", sa.DateTime(), server_default=NOW))

    with op.batch_alter_table("farmers") as batch:
        batch.add_column(sa.Column("number_of_cows", sa.Integer()))
        batch.add_column(sa.Column("payment_method", sa.String(20)))
        batch.add_column(sa.Column("payment_account", sa.String(100)))
        batch.add_column(sa.Column("bank_name", sa.String(100)))
        batch.add_column(sa.Column("updated_at", sa.DateTime(), server_default=NOW))

    with op.batch_alter_table("collection_centres") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(), server_default=NOW))

    # Coolers: add the code nullable, backfill it, then tighten.
    with op.batch_alter_table("coolers") as batch:
        batch.add_column(sa.Column("code", sa.String(50)))
        batch.add_column(sa.Column("centre_id", sa.Uuid()))
        batch.add_column(sa.Column("capacity_litres", sa.Numeric(10, 2)))
        batch.add_column(sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"))
        batch.add_column(sa.Column("last_temperature_c", sa.Numeric(5, 2)))
        batch.add_column(sa.Column("last_reading_at", sa.DateTime()))
        batch.add_column(sa.Column("updated_at", sa.DateTime(), server_default=NOW))
    if not context.is_offline_mode():
        _backfill_cooler_codes()
    with op.batch_alter_table("coolers") as batch:
        batch.alter_column("code", existing_type=sa.String(50), nullable=False)
        batch.alter_column("cooperative_id", existing_type=sa.Uuid(), nullable=False)
        batch.create_foreign_key(
            "coolers_centre_id_fkey", "collection_centres", ["centre_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index("uq_coolers_cooperative_code", "coolers", ["cooperative_id", "code"], unique=True)
    op.create_index("ix_coolers_cooperative_id", "coolers", ["cooperative_id"])
    op.create_index("ix_coolers_centre_id", "coolers", ["centre_id"])

    op.create_table(
        "collectors",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("collector_number", sa.String(50), nullable=False),
        sa.Column("assigned_area", sa.String(255)),
        sa.Column("centre_id", sa.Uuid()),
        sa.Column("cooler_id", sa.Uuid()),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="collectors_pkey"),
        sa.UniqueConstraint("user_id", name="collectors_user_id_key"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="collectors_user_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="collectors_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["centre_id"], ["collection_centres.id"], name="collectors_centre_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="collectors_cooler_id_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_collectors_cooperative_id", "collectors", ["cooperative_id"])
    op.create_index("uq_collectors_cooperative_number", "collectors", ["cooperative_id", "collector_number"], unique=True)
    if not context.is_offline_mode():
        _backfill_collectors()

    op.drop_table("milk_collections")
    _create_milk_collections(uuid_default)

    with op.batch_alter_table("audit_logs") as batch:
        batch.add_column(sa.Column("actor_email", sa.String(255)))
        batch.add_column(sa.Column("actor_role", sa.String(50)))
        batch.add_column(sa.Column("entity_type", sa.String(50)))
        batch.add_column(sa.Column("entity_id", sa.String(64)))
        batch.add_column(sa.Column("cooperative_id", sa.Uuid()))
        batch.add_column(sa.Column("old_values", JSON_TYPE))
        batch.add_column(sa.Column("new_values", JSON_TYPE))
        batch.add_column(sa.Column("ip_address", sa.String(64)))
        batch.add_column(sa.Column("user_agent", sa.String(500)))
        batch.alter_column("admin_id", existing_type=sa.Uuid(), nullable=True)
        batch.drop_constraint("audit_logs_admin_id_fkey", type_="foreignkey")
        batch.create_foreign_key("audit_logs_admin_id_fkey", "users", ["admin_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key(
            "audit_logs_cooperative_id_fkey", "cooperatives", ["cooperative_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_cooperative_id", "audit_logs", ["cooperative_id"])
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    # Existing entries were all written by superadmin decisions.
    op.execute(sa.text("UPDATE audit_logs SET actor_role = 'SUPER_ADMIN' WHERE actor_role IS NULL"))
    op.execute(sa.text(
        "UPDATE audit_logs SET actor_email = (SELECT email FROM users WHERE users.id = audit_logs.admin_id) "
        "WHERE actor_email IS NULL"
    ))

    with op.batch_alter_table("sms_credit_payments") as batch:
        batch.add_column(sa.Column("rejection_reason", sa.Text()))
        batch.add_column(sa.Column("submitted_by", sa.Uuid()))
        batch.create_foreign_key(
            "sms_credit_payments_submitted_by_fkey", "users", ["submitted_by"], ["id"], ondelete="SET NULL"
        )

    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", JSON_TYPE),
        sa.Column("updated_by", sa.Uuid()),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("key", name="platform_settings_pkey"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], name="platform_settings_updated_by_fkey", ondelete="SET NULL"),
    )


def downgrade() -> None:
    is_pg = context.get_context().dialect.name == "postgresql"
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None

    op.drop_table("platform_settings")

    with op.batch_alter_table("sms_credit_payments") as batch:
        batch.drop_constraint("sms_credit_payments_submitted_by_fkey", type_="foreignkey")
        batch.drop_column("submitted_by")
        batch.drop_column("rejection_reason")

    for index in ("ix_audit_logs_action", "ix_audit_logs_entity", "ix_audit_logs_cooperative_id", "ix_audit_logs_created_at"):
        op.drop_index(index, table_name="audit_logs")
    # The old schema requires an actor on every entry.
    op.execute(sa.text("DELETE FROM audit_logs WHERE admin_id IS NULL"))
    with op.batch_alter_table("audit_logs") as batch:
        batch.drop_constraint("audit_logs_cooperative_id_fkey", type_="foreignkey")
        batch.drop_constraint("audit_logs_admin_id_fkey", type_="foreignkey")
        batch.create_foreign_key("audit_logs_admin_id_fkey", "users", ["admin_id"], ["id"], ondelete="CASCADE")
        batch.alter_column("admin_id", existing_type=sa.Uuid(), nullable=False)
        for column in (
            "user_agent", "ip_address", "new_values", "old_values", "cooperative_id",
            "entity_id", "entity_type", "actor_role", "actor_email",
        ):
            batch.drop_column(column)

    # Collections recorded under the new structure can't be expressed in the baseline table.
    op.drop_table("milk_collections")
    op.create_table(
        "milk_collections",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("farmer_id", sa.Uuid()),
        sa.Column("collector_id", sa.Uuid()),
        sa.Column("quantity_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("fat_content", sa.Numeric(5, 2)),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="milk_collections_pkey"),
        sa.ForeignKeyConstraint(["farmer_id"], ["users.id"], name="milk_collections_farmer_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["collector_id"], ["users.id"], name="milk_collections_collector_id_fkey", ondelete="SET NULL"),
    )

    op.drop_table("collectors")

    op.drop_index("ix_coolers_centre_id", table_name="coolers")
    op.drop_index("ix_coolers_cooperative_id", table_name="coolers")
    op.drop_index("uq_coolers_cooperative_code", table_name="coolers")
    with op.batch_alter_table("coolers") as batch:
        batch.drop_constraint("coolers_centre_id_fkey", type_="foreignkey")
        batch.alter_column("cooperative_id", existing_type=sa.Uuid(), nullable=True)
        for column in ("updated_at", "last_reading_at", "last_temperature_c", "status", "capacity_litres", "centre_id", "code"):
            batch.drop_column(column)

    with op.batch_alter_table("collection_centres") as batch:
        batch.drop_column("updated_at")

    with op.batch_alter_table("farmers") as batch:
        for column in ("updated_at", "bank_name", "payment_account", "payment_method", "number_of_cows"):
            batch.drop_column(column)

    with op.batch_alter_table("users") as batch:
        batch.drop_column("updated_at")
        batch.drop_column("last_login_at")

    with op.batch_alter_table("cooperatives") as batch:
        for column in ("updated_at", "suspended_at", "suspension_reason", "contact_phone", "contact_email"):
            batch.drop_column(column)
