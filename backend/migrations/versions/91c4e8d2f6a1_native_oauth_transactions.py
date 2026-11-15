"""Add secure storage for native Google OAuth transactions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "91c4e8d2f6a1"
down_revision: str | Sequence[str] | None = "7bf62a1bc3c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "native_oauth_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("pkce_verifier_encrypted", sa.String(length=512), nullable=False),
        sa.Column("ticket_hash", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("state_used_at", sa.DateTime(), nullable=True),
        sa.Column("ticket_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_native_oauth_transactions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash"),
        sa.UniqueConstraint("ticket_hash"),
    )

    op.create_index(
        "ix_native_oauth_expires_at",
        "native_oauth_transactions",
        ["expires_at"],
    )

    op.create_index(
        "ix_native_oauth_user_id",
        "native_oauth_transactions",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_native_oauth_user_id",
        table_name="native_oauth_transactions",
    )
    op.drop_index(
        "ix_native_oauth_expires_at",
        table_name="native_oauth_transactions",
    )
    op.drop_table("native_oauth_transactions")
