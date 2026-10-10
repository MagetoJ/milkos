"""Account lifecycle and security: account status, phone verification, activation links, password resets, SMS
one-time codes, MFA, session revocation, personal preferences, payment information requests and SMS billing.

Existing data is preserved:
- users.account_status is derived from is_active: active accounts become ACTIVE; inactive accounts linked to a
  PENDING cooperative application become PENDING_APPROVAL; every other inactive account becomes DISABLED.
- Existing accounts keep their password (password_set_at = created_at). No phone is marked verified, because
  nobody has proven ownership yet.
- users.email and users.password_hash become nullable (collectors and farmers may have no email; accounts
  created by an administrator have no password until the person sets one).
- notifications.cooperative_id becomes nullable (messages to platform accounts) and every existing row is
  billed to its cooperative.

Revision ID: 0008_account_security
Revises: 0007_batches_finance
Create Date: 2026-10-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0008_account_security"
down_revision: Union[str, Sequence[str], None] = "0007_batches_finance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
NOW = sa.text("CURRENT_TIMESTAMP")


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email", existing_type=sa.String(255), nullable=True)
        batch.alter_column("password_hash", existing_type=sa.String(255), nullable=True)
        batch.add_column(sa.Column("account_status", sa.String(30), nullable=False, server_default="ACTIVE"))
        batch.add_column(sa.Column("status_reason", sa.Text()))
        batch.add_column(sa.Column("phone_verified_at", sa.DateTime()))
        batch.add_column(sa.Column("password_set_at", sa.DateTime()))
        batch.add_column(sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("invited_at", sa.DateTime()))
        batch.add_column(sa.Column("invited_by", sa.Uuid()))
        batch.add_column(sa.Column("activated_at", sa.DateTime()))
        batch.add_column(sa.Column("session_epoch", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("locked_until", sa.DateTime()))
        batch.add_column(sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("mfa_secret_encrypted", sa.Text()))
        batch.add_column(sa.Column("mfa_enabled_at", sa.DateTime()))
        batch.add_column(sa.Column("mfa_recovery_codes", JSON_TYPE))
        batch.create_foreign_key("fk_users_invited_by", "users", ["invited_by"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_users_account_status", ["account_status"])

    users = sa.table(
        "users", sa.column("id", sa.Uuid()), sa.column("is_active", sa.Boolean()), sa.column("account_status", sa.String()),
        sa.column("password_set_at", sa.DateTime()), sa.column("created_at", sa.DateTime()),
        sa.column("activated_at", sa.DateTime()),
    )
    apps = sa.table("cooperative_applications", sa.column("admin_user_id", sa.Uuid()), sa.column("status", sa.String()))
    op.execute(users.update().where(users.c.is_active.is_(True)).values(account_status="ACTIVE"))
    op.execute(
        users.update()
        .where(sa.or_(users.c.is_active.is_(False), users.c.is_active.is_(None)))
        .where(users.c.id.in_(sa.select(apps.c.admin_user_id).where(apps.c.status == "PENDING")))
        .values(account_status="PENDING_APPROVAL", is_active=False)
    )
    op.execute(
        users.update()
        .where(sa.or_(users.c.is_active.is_(False), users.c.is_active.is_(None)))
        .where(users.c.account_status == "ACTIVE")
        .values(account_status="DISABLED", is_active=False)
    )
    op.execute(users.update().values(password_set_at=users.c.created_at, activated_at=users.c.created_at))

    op.create_table(
        "account_activations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("opened_at", sa.DateTime()),
        sa.Column("otp_verified_at", sa.DateTime()),
        sa.Column("used_at", sa.DateTime()),
        sa.Column("revoked_at", sa.DateTime()),
        sa.Column("revoked_reason", sa.String(100)),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id", ondelete="SET NULL")),
    )
    op.create_index("ix_account_activations_user_id", "account_activations", ["user_id"])

    op.create_table(
        "password_resets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("requested_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime()),
        sa.Column("revoked_at", sa.DateTime()),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id", ondelete="SET NULL")),
    )
    op.create_index("ix_password_resets_user_id", "password_resets", ["user_id"])

    op.create_table(
        "phone_verifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("phone", sa.String(50), nullable=False),
        sa.Column("activation_id", sa.Uuid(), sa.ForeignKey("account_activations.id", ondelete="CASCADE")),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.Column("send_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verified_at", sa.DateTime()),
        sa.Column("revoked_at", sa.DateTime()),
        sa.Column("requested_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("notification_id", sa.Uuid(), sa.ForeignKey("notifications.id", ondelete="SET NULL")),
    )
    op.create_index("ix_phone_verifications_user_id", "phone_verifications", ["user_id"])
    op.create_index("ix_phone_verifications_user_purpose", "phone_verifications", ["user_id", "purpose", "created_at"])

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("notifications", JSON_TYPE, nullable=False),
        sa.Column("work", JSON_TYPE, nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
    )

    with op.batch_alter_table("notifications") as batch:
        batch.alter_column("cooperative_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("billed_to", sa.String(20), nullable=False, server_default="COOPERATIVE"))
        batch.add_column(sa.Column("delivered_at", sa.DateTime()))
    op.create_index("ix_notifications_provider_message_id", "notifications", ["provider_message_id"])

    with op.batch_alter_table("sms_credit_payments") as batch:
        batch.add_column(sa.Column("info_request", sa.Text()))
        batch.add_column(sa.Column("info_requested_by", sa.Uuid()))
        batch.add_column(sa.Column("info_requested_at", sa.DateTime()))
        batch.add_column(sa.Column("info_response", sa.Text()))
        batch.add_column(sa.Column("info_responded_by", sa.Uuid()))
        batch.add_column(sa.Column("info_responded_at", sa.DateTime()))
        batch.create_foreign_key("fk_sms_payments_info_requested_by", "users", ["info_requested_by"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_sms_payments_info_responded_by", "users", ["info_responded_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("sms_credit_payments") as batch:
        batch.drop_constraint("fk_sms_payments_info_responded_by", type_="foreignkey")
        batch.drop_constraint("fk_sms_payments_info_requested_by", type_="foreignkey")
        for name in ("info_responded_at", "info_responded_by", "info_response", "info_requested_at", "info_requested_by", "info_request"):
            batch.drop_column(name)
    # A payment left waiting for information goes back to the queue it came from.
    op.execute("UPDATE sms_credit_payments SET status = 'PENDING' WHERE status = 'AWAITING_INFORMATION'")

    op.drop_index("ix_notifications_provider_message_id", table_name="notifications")
    # Platform-billed messages have no cooperative and can't exist in the old schema.
    op.execute("DELETE FROM notifications WHERE cooperative_id IS NULL")
    op.execute("UPDATE notifications SET status = 'SENT' WHERE status = 'DELIVERED'")
    with op.batch_alter_table("notifications") as batch:
        batch.drop_column("delivered_at")
        batch.drop_column("billed_to")
        batch.alter_column("cooperative_id", existing_type=sa.Uuid(), nullable=False)

    op.drop_table("user_preferences")
    op.drop_index("ix_phone_verifications_user_purpose", table_name="phone_verifications")
    op.drop_index("ix_phone_verifications_user_id", table_name="phone_verifications")
    op.drop_table("phone_verifications")
    op.drop_index("ix_password_resets_user_id", table_name="password_resets")
    op.drop_table("password_resets")
    op.drop_index("ix_account_activations_user_id", table_name="account_activations")
    op.drop_table("account_activations")

    # The old schema needs an email and a password hash on every account. Accounts that never got either
    # (invited, not yet activated) are given an unusable placeholder so the downgrade never deletes people.
    op.execute("UPDATE users SET email = 'pending-' || CAST(id AS VARCHAR(36)) || '@invalid.milkos' WHERE email IS NULL")
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    op.execute("UPDATE users SET is_active = false WHERE account_status <> 'ACTIVE'")
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_account_status")
        batch.drop_constraint("fk_users_invited_by", type_="foreignkey")
        for name in (
            "mfa_recovery_codes", "mfa_enabled_at", "mfa_secret_encrypted", "mfa_enabled", "locked_until",
            "failed_login_count", "session_epoch", "activated_at", "invited_by", "invited_at", "must_change_password",
            "password_set_at", "phone_verified_at", "status_reason", "account_status",
        ):
            batch.drop_column(name)
        batch.alter_column("password_hash", existing_type=sa.String(255), nullable=False)
        batch.alter_column("email", existing_type=sa.String(255), nullable=False)
