"""Collection centres, farmers and cooperative memberships.

Adds the three tables the farmers/collectors module models already define.
Only creates new tables; nothing existing is changed.

Revision ID: 0003_farmers_centres
Revises: 0002_cooperative_onboarding
Create Date: 2026-10-01
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa

revision: str = "0003_farmers_centres"
down_revision: Union[str, Sequence[str], None] = "0002_cooperative_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_pg = context.get_context().dialect.name == "postgresql"
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None

    def pk() -> sa.Column:
        return sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default)

    op.create_table(
        "collection_centres",
        pk(),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("county", sa.String(100), nullable=False),
        sa.Column("location_description", sa.Text()),
        sa.Column("manager_user_id", sa.Uuid()),
        sa.Column("has_cooler", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cooler_capacity_litres", sa.Numeric(10, 2)),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id", name="collection_centres_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="collection_centres_cooperative_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_collection_centres_cooperative_id", "collection_centres", ["cooperative_id"])
    op.create_index("ix_collection_centres_code", "collection_centres", ["code"])

    op.create_table(
        "farmers",
        pk(),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("centre_id", sa.Uuid()),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("farmer_number", sa.String(50), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("phone", sa.String(30), nullable=False),
        sa.Column("national_id", sa.String(50)),
        sa.Column("village", sa.String(150)),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id", name="farmers_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="farmers_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["centre_id"], ["collection_centres.id"], name="farmers_centre_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="farmers_user_id_fkey", ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", name="farmers_user_id_key"),
    )
    op.create_index("ix_farmers_cooperative_id", "farmers", ["cooperative_id"])
    op.create_index("ix_farmers_centre_id", "farmers", ["centre_id"])
    op.create_index("ix_farmers_farmer_number", "farmers", ["farmer_number"])

    op.create_table(
        "cooperative_memberships",
        pk(),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id", name="cooperative_memberships_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="cooperative_memberships_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="cooperative_memberships_user_id_fkey", ondelete="CASCADE"),
        sa.UniqueConstraint("cooperative_id", "user_id", name="uq_cooperative_user"),
    )
    op.create_index("ix_cooperative_memberships_cooperative_id", "cooperative_memberships", ["cooperative_id"])
    op.create_index("ix_cooperative_memberships_user_id", "cooperative_memberships", ["user_id"])


def downgrade() -> None:
    op.drop_table("cooperative_memberships")
    op.drop_table("farmers")
    op.drop_table("collection_centres")