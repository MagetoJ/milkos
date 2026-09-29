"""Baseline: the schema as it existed in Supabase before Alembic was introduced.

On the existing Supabase database this revision is only STAMPED (`alembic stamp 0001_baseline`),
never run. On an empty database (fresh environment, tests) it creates the same tables.
Constraint names follow Postgres' defaults so they match what Supabase already has.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa

revision: str = "0001_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_ROLES = ("ADMIN", "MANAGER", "COLLECTOR", "FARMER", "SUPER_ADMIN", "COOP_ADMIN")


def upgrade() -> None:
    is_pg = context.get_context().dialect.name == "postgresql"
    # Supabase uses uuid_generate_v4() (uuid-ossp); gen_random_uuid() is built into Postgres 13+.
    # The models always supply ids themselves, so this only matters for manual inserts.
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None
    now = sa.text("CURRENT_TIMESTAMP")

    def pk() -> sa.Column:
        return sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default)

    op.create_table(
        "cooperatives",
        pk(),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("location", sa.String(255)),
        sa.Column("created_at", sa.DateTime(), server_default=now),
        sa.PrimaryKeyConstraint("id", name="cooperatives_pkey"),
        sa.UniqueConstraint("code", name="cooperatives_code_key"),
    )

    op.create_table(
        "users",
        pk(),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("phone_number", sa.String(50), nullable=False),
        sa.Column("role", sa.Enum(*USER_ROLES, name="user_role"), server_default="FARMER"),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=now),
        sa.PrimaryKeyConstraint("id", name="users_pkey"),
        sa.UniqueConstraint("email", name="users_email_key"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="users_cooperative_id_fkey", ondelete="SET NULL"),
    )

    op.create_table(
        "cooperative_applications",
        pk(),
        sa.Column("org_name", sa.String(255), nullable=False),
        sa.Column("applicant_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(50), nullable=False),
        sa.Column("location", sa.String(255), nullable=False),
        sa.Column("status", sa.String(50), server_default="PENDING"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=now),
        sa.Column("updated_at", sa.DateTime(), server_default=now),
        sa.PrimaryKeyConstraint("id", name="cooperative_applications_pkey"),
    )

    op.create_table(
        "coolers",
        pk(),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("location", sa.String(255)),
        sa.Column("scale_device_id", sa.String(255)),
        sa.Column("is_operational", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=now),
        sa.PrimaryKeyConstraint("id", name="coolers_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="coolers_cooperative_id_fkey", ondelete="CASCADE"),
    )

    op.create_table(
        "sms_credit_packages",
        pk(),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("credits_amount", sa.Integer(), nullable=False),
        sa.Column("price_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.PrimaryKeyConstraint("id", name="sms_credit_packages_pkey"),
    )

    op.create_table(
        "sms_credit_payments",
        pk(),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("package_id", sa.Uuid()),
        sa.Column("amount_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("credits_requested", sa.Integer(), nullable=False),
        sa.Column("mpesa_reference", sa.String(100), nullable=False),
        sa.Column("masked_mpesa_ref", sa.String(100), nullable=False),
        sa.Column("status", sa.String(50), server_default="PENDING"),
        sa.Column("verified_by", sa.Uuid()),
        sa.Column("submitted_at", sa.DateTime(), server_default=now),
        sa.Column("verified_at", sa.DateTime()),
        sa.PrimaryKeyConstraint("id", name="sms_credit_payments_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="sms_credit_payments_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["package_id"], ["sms_credit_packages.id"], name="sms_credit_payments_package_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"], name="sms_credit_payments_verified_by_fkey", ondelete="SET NULL"),
    )

    op.create_table(
        "milk_collections",
        pk(),
        sa.Column("farmer_id", sa.Uuid()),
        sa.Column("collector_id", sa.Uuid()),
        sa.Column("quantity_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("fat_content", sa.Numeric(5, 2)),
        sa.Column("created_at", sa.DateTime(), server_default=now),
        sa.PrimaryKeyConstraint("id", name="milk_collections_pkey"),
        sa.ForeignKeyConstraint(["farmer_id"], ["users.id"], name="milk_collections_farmer_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["collector_id"], ["users.id"], name="milk_collections_collector_id_fkey", ondelete="SET NULL"),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("admin_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime()),
        sa.PrimaryKeyConstraint("id", name="audit_logs_pkey"),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"], name="audit_logs_admin_id_fkey", ondelete="CASCADE"),
    )


def downgrade() -> None:
    for table in (
        "audit_logs", "milk_collections", "sms_credit_payments", "sms_credit_packages",
        "coolers", "cooperative_applications", "users", "cooperatives",
    ):
        op.drop_table(table)
    sa.Enum(name="user_role").drop(op.get_bind(), checkfirst=True)
