"""Cooperative onboarding: cooperative details, application review fields, unique phones.

Only adds columns, constraints and indexes; no existing column or row is changed or removed.
Before changing anything it checks that the existing data allows the new constraints and
stops with an explanation if it doesn't.

Revision ID: 0002_cooperative_onboarding
Revises: 0001_baseline
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_cooperative_onboarding"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PENDING_ONLY = sa.text("status = 'PENDING'")


def _check_existing_data() -> None:
    from core.validation import normalize_phone

    bind = op.get_bind()
    problems = []

    coop_rows = bind.execute(sa.text("SELECT COUNT(*) FROM cooperatives")).scalar()
    if coop_rows:
        problems.append(
            f"cooperatives has {coop_rows} row(s); the new NOT NULL columns (registration_number, "
            "kra_pin, county) need values for them first."
        )

    phones = [row[0] for row in bind.execute(sa.text("SELECT phone_number FROM users"))]
    seen, bad, dupes = set(), 0, 0
    for phone in phones:
        try:
            normalized = normalize_phone(phone)
        except ValueError:
            bad += 1
            continue
        if normalized != phone:
            bad += 1
        if normalized in seen:
            dupes += 1
        seen.add(normalized)
    if bad:
        problems.append(f"{bad} users.phone_number value(s) are not Kenyan E.164 numbers (+2547.../+2541...).")
    if dupes:
        problems.append(f"{dupes} users share a phone number with another user once normalised.")

    if problems:
        raise RuntimeError(
            "Migration 0002 stopped before changing anything:\n  - " + "\n  - ".join(problems)
            + "\nFix the data (nothing was modified), then run `alembic upgrade head` again."
        )


def upgrade() -> None:
    if not context.is_offline_mode():
        _check_existing_data()

    json_type = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

    with op.batch_alter_table("cooperatives") as batch:
        batch.add_column(sa.Column("registration_number", sa.String(50), nullable=False))
        batch.add_column(sa.Column("kra_pin", sa.String(11), nullable=False))
        batch.add_column(sa.Column("county", sa.String(50), nullable=False))
        batch.add_column(sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"))
        batch.add_column(sa.Column("sms_credit_balance", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("estimated_daily_liters", sa.Numeric(12, 2)))
        batch.create_unique_constraint("cooperatives_registration_number_key", ["registration_number"])
        batch.create_unique_constraint("cooperatives_kra_pin_key", ["kra_pin"])

    with op.batch_alter_table("cooperative_applications") as batch:
        batch.add_column(sa.Column("registration_number", sa.String(50)))
        batch.add_column(sa.Column("kra_pin", sa.String(11)))
        batch.add_column(sa.Column("county", sa.String(50)))
        batch.add_column(sa.Column("sub_county", sa.String(255)))
        batch.add_column(sa.Column("admin_id_number", sa.String(20)))
        batch.add_column(sa.Column("estimated_daily_liters", sa.Numeric(12, 2)))
        batch.add_column(sa.Column("initial_coolers_count", sa.Integer()))
        batch.add_column(sa.Column("admin_user_id", sa.Uuid()))
        batch.add_column(sa.Column("cooperative_id", sa.Uuid()))
        batch.add_column(sa.Column("rejection_reason", sa.Text()))
        batch.add_column(sa.Column("reviewed_by", sa.Uuid()))
        batch.add_column(sa.Column("reviewed_at", sa.DateTime()))
        batch.add_column(sa.Column("flags", json_type, nullable=False, server_default=sa.text("'[]'")))
        batch.create_foreign_key(
            "cooperative_applications_admin_user_id_fkey", "users", ["admin_user_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_foreign_key(
            "cooperative_applications_cooperative_id_fkey", "cooperatives", ["cooperative_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_foreign_key(
            "cooperative_applications_reviewed_by_fkey", "users", ["reviewed_by"], ["id"], ondelete="SET NULL"
        )

    # At most one application per registration number / KRA PIN may be awaiting review.
    op.create_index(
        "uq_coop_applications_pending_registration_number", "cooperative_applications", ["registration_number"],
        unique=True, postgresql_where=PENDING_ONLY, sqlite_where=PENDING_ONLY,
    )
    op.create_index(
        "uq_coop_applications_pending_kra_pin", "cooperative_applications", ["kra_pin"],
        unique=True, postgresql_where=PENDING_ONLY, sqlite_where=PENDING_ONLY,
    )

    with op.batch_alter_table("users") as batch:
        batch.create_unique_constraint("users_phone_number_key", ["phone_number"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("users_phone_number_key", type_="unique")

    op.drop_index("uq_coop_applications_pending_kra_pin", table_name="cooperative_applications")
    op.drop_index("uq_coop_applications_pending_registration_number", table_name="cooperative_applications")

    with op.batch_alter_table("cooperative_applications") as batch:
        batch.drop_constraint("cooperative_applications_reviewed_by_fkey", type_="foreignkey")
        batch.drop_constraint("cooperative_applications_cooperative_id_fkey", type_="foreignkey")
        batch.drop_constraint("cooperative_applications_admin_user_id_fkey", type_="foreignkey")
        for column in (
            "flags", "reviewed_at", "reviewed_by", "rejection_reason", "cooperative_id", "admin_user_id",
            "initial_coolers_count", "estimated_daily_liters", "admin_id_number", "sub_county", "county",
            "kra_pin", "registration_number",
        ):
            batch.drop_column(column)

    with op.batch_alter_table("cooperatives") as batch:
        batch.drop_constraint("cooperatives_kra_pin_key", type_="unique")
        batch.drop_constraint("cooperatives_registration_number_key", type_="unique")
        for column in ("estimated_daily_liters", "sms_credit_balance", "status", "county", "kra_pin", "registration_number"):
            batch.drop_column(column)
