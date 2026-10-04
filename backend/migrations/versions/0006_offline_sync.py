"""Offline-first foundation: devices, offline sessions, sync log, cooler sensors/readings, notifications.

- devices, device_sessions:  app installations and per-user offline sessions (hashed secret + expiry)
- sync_mutations:            idempotency record of every mutation a device pushed
- sync_changes:              append-only change log; its id is the pull cursor. Backfilled with one row per
                             existing synchronised record so the first pull of an existing cooperative works
- sensor_devices:            cooler sensors and their binding to a cooler
- cooler_readings:           append-only level/temperature measurements
- notifications:             cooler alerts and their SMS delivery state
- coolers:                   manager, current level, last seen, alert thresholds, sync_version
- cooperatives:              alert_sms_enabled
- farmers, collection_centres, collectors, milk_collections: sync_version
- milk_collections:          device_id and client_recorded_at (offline capture metadata)

Revision ID: 0006_offline_sync
Revises: 0005_platform_admin
Create Date: 2026-10-04
"""
import datetime
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0006_offline_sync"
down_revision: Union[str, Sequence[str], None] = "0005_platform_admin"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
NOW = sa.text("CURRENT_TIMESTAMP")
VERSIONED = ("farmers", "collection_centres", "collectors", "milk_collections")


def _sync_version() -> sa.Column:
    return sa.Column("sync_version", sa.Integer(), nullable=False, server_default="1")


def _backfill_change_log() -> None:
    """One change per existing record, so a device's first pull (cursor 0) receives everything."""
    bind = op.get_bind()
    changes = sa.table(
        "sync_changes",
        sa.column("cooperative_id", sa.Uuid()), sa.column("entity_type", sa.String()),
        sa.column("entity_id", sa.String()), sa.column("changed_at", sa.DateTime()),
    )
    now = datetime.datetime.utcnow()
    sources = (
        ("cooperative", "SELECT id, id FROM cooperatives"),
        ("centre", "SELECT id, cooperative_id FROM collection_centres"),
        ("cooler", "SELECT id, cooperative_id FROM coolers"),
        ("farmer", "SELECT id, cooperative_id FROM farmers"),
        ("team_member", "SELECT id, cooperative_id FROM users WHERE cooperative_id IS NOT NULL "
                        "AND role IN ('COOP_ADMIN', 'MANAGER', 'COLLECTOR')"),
        ("collector", "SELECT id, cooperative_id FROM collectors"),
        ("collection", "SELECT id, cooperative_id FROM milk_collections"),
    )
    uuid_type = sa.Uuid()
    to_uuid = uuid_type.result_processor(bind.dialect, None) or (lambda v: v)
    for entity_type, sql in sources:
        rows = bind.execute(sa.text(sql)).fetchall()
        if rows:
            bind.execute(changes.insert(), [
                {"cooperative_id": to_uuid(coop), "entity_type": entity_type, "entity_id": str(to_uuid(entity_id)), "changed_at": now}
                for entity_id, coop in rows
            ])


def upgrade() -> None:
    is_pg = context.get_context().dialect.name == "postgresql"
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None

    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("device_identifier", sa.String(64), nullable=False),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("registered_by", sa.Uuid()),
        sa.Column("label", sa.String(100)),
        sa.Column("platform", sa.String(100)),
        sa.Column("app_version", sa.String(50)),
        sa.Column("user_agent", sa.String(500)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_seen_at", sa.DateTime()),
        sa.Column("last_sync_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="devices_pkey"),
        sa.UniqueConstraint("device_identifier", name="devices_device_identifier_key"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="devices_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["registered_by"], ["users.id"], name="devices_registered_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_devices_cooperative_id", "devices", ["cooperative_id"])

    op.create_table(
        "device_sessions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("previous_token_hash", sa.String(64)),
        sa.Column("previous_valid_until", sa.DateTime()),
        sa.Column("issued_at", sa.DateTime(), server_default=NOW),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_validated_at", sa.DateTime()),
        sa.Column("revoked_at", sa.DateTime()),
        sa.PrimaryKeyConstraint("id", name="device_sessions_pkey"),
        sa.UniqueConstraint("token_hash", name="device_sessions_token_hash_key"),
        sa.UniqueConstraint("device_id", "user_id", name="uq_device_sessions_device_user"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], name="device_sessions_device_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="device_sessions_user_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_device_sessions_device_id", "device_sessions", ["device_id"])
    op.create_index("ix_device_sessions_user_id", "device_sessions", ["user_id"])
    op.create_index("ix_device_sessions_previous_token_hash", "device_sessions", ["previous_token_hash"])

    op.create_table(
        "sync_mutations",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("mutation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("operation", sa.String(20), nullable=False),
        sa.Column("local_id", sa.String(64), nullable=False),
        sa.Column("server_id", sa.String(64)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(50)),
        sa.Column("error_message", sa.Text()),
        sa.Column("client_timestamp", sa.DateTime()),
        sa.Column("received_at", sa.DateTime(), server_default=NOW),
        sa.Column("resolved_at", sa.DateTime()),
        sa.Column("resolution", sa.String(30)),
        sa.PrimaryKeyConstraint("id", name="sync_mutations_pkey"),
        sa.UniqueConstraint("device_id", "mutation_id", name="uq_sync_mutations_device_mutation"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], name="sync_mutations_device_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="sync_mutations_user_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="sync_mutations_cooperative_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_sync_mutations_coop_received", "sync_mutations", ["cooperative_id", "received_at"])
    op.create_index("ix_sync_mutations_device_local", "sync_mutations", ["device_id", "local_id"])

    op.create_table(
        "sync_changes",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False, autoincrement=True),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="sync_changes_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="sync_changes_cooperative_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_sync_changes_coop_id", "sync_changes", ["cooperative_id", "id"])

    with op.batch_alter_table("cooperatives") as batch:
        batch.add_column(sa.Column("alert_sms_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))

    with op.batch_alter_table("coolers") as batch:
        batch.add_column(sa.Column("manager_user_id", sa.Uuid()))
        batch.add_column(sa.Column("current_volume_litres", sa.Numeric(10, 2)))
        batch.add_column(sa.Column("last_seen_at", sa.DateTime()))
        batch.add_column(sa.Column("low_volume_alert_litres", sa.Numeric(10, 2)))
        batch.add_column(sa.Column("high_volume_alert_litres", sa.Numeric(10, 2)))
        batch.add_column(sa.Column("min_temperature_c", sa.Numeric(5, 2)))
        batch.add_column(sa.Column("max_temperature_c", sa.Numeric(5, 2)))
        batch.add_column(sa.Column("stale_after_minutes", sa.Integer()))
        batch.add_column(sa.Column("low_battery_percent", sa.Integer()))
        batch.add_column(sa.Column("alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(_sync_version())
        batch.create_foreign_key("coolers_manager_user_id_fkey", "users", ["manager_user_id"], ["id"], ondelete="SET NULL")

    for table in VERSIONED:
        with op.batch_alter_table(table) as batch:
            batch.add_column(_sync_version())
            if table == "milk_collections":
                batch.add_column(sa.Column("device_id", sa.Uuid()))
                batch.add_column(sa.Column("client_recorded_at", sa.DateTime()))
                batch.create_foreign_key(
                    "milk_collections_device_id_fkey", "devices", ["device_id"], ["id"], ondelete="SET NULL"
                )

    op.create_table(
        "sensor_devices",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("cooler_id", sa.Uuid()),
        sa.Column("sensor_identifier", sa.String(128), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sensor_type", sa.String(40), nullable=False),
        sa.Column("transport", sa.String(20), nullable=False),
        sa.Column("protocol", sa.String(80)),
        sa.Column("bluetooth_device_id", sa.String(255)),
        sa.Column("bluetooth_name", sa.String(255)),
        sa.Column("firmware_version", sa.String(50)),
        sa.Column("calibration", JSON_TYPE),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_seen_at", sa.DateTime()),
        sa.Column("last_connection_state", sa.String(20)),
        sa.Column("bound_at", sa.DateTime()),
        sa.Column("bound_by", sa.Uuid()),
        _sync_version(),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="sensor_devices_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="sensor_devices_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="sensor_devices_cooler_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["bound_by"], ["users.id"], name="sensor_devices_bound_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_sensor_devices_cooperative_id", "sensor_devices", ["cooperative_id"])
    op.create_index("ix_sensor_devices_cooler_id", "sensor_devices", ["cooler_id"])
    op.create_index(
        "uq_sensor_devices_cooperative_identifier", "sensor_devices", ["cooperative_id", "sensor_identifier"], unique=True
    )

    op.create_table(
        "cooler_readings",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("cooler_id", sa.Uuid(), nullable=False),
        sa.Column("sensor_id", sa.Uuid()),
        sa.Column("volume_litres", sa.Numeric(10, 2)),
        sa.Column("temperature_celsius", sa.Numeric(5, 2)),
        sa.Column("battery_percent", sa.Integer()),
        sa.Column("signal_strength", sa.Integer()),
        sa.Column("measured_at", sa.DateTime(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.Column("device_id", sa.Uuid()),
        sa.Column("recorded_by", sa.Uuid()),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("quality", sa.String(20), nullable=False, server_default="VALID"),
        sa.Column("quality_flags", JSON_TYPE),
        sa.Column("measurement_key", sa.String(255), nullable=False),
        sa.Column("sequence", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="cooler_readings_pkey"),
        sa.CheckConstraint("volume_litres IS NULL OR volume_litres >= 0", name="ck_cooler_readings_volume_non_negative"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="cooler_readings_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="cooler_readings_cooler_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sensor_id"], ["sensor_devices.id"], name="cooler_readings_sensor_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], name="cooler_readings_device_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], name="cooler_readings_recorded_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("uq_cooler_readings_cooler_measurement", "cooler_readings", ["cooler_id", "measurement_key"], unique=True)
    op.create_index("ix_cooler_readings_cooler_measured", "cooler_readings", ["cooler_id", "measured_at"])
    op.create_index("ix_cooler_readings_coop_measured", "cooler_readings", ["cooperative_id", "measured_at"])
    op.create_index("ix_cooler_readings_measured_at", "cooler_readings", ["measured_at"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("cooler_id", sa.Uuid()),
        sa.Column("reading_id", sa.Uuid()),
        sa.Column("recipient_user_id", sa.Uuid()),
        sa.Column("recipient_phone", sa.String(50), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False, server_default="SMS"),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context", JSON_TYPE),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("provider", sa.String(50)),
        sa.Column("provider_message_id", sa.String(255)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("sent_at", sa.DateTime()),
        sa.Column("failed_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="notifications_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="notifications_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="notifications_cooler_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reading_id"], ["cooler_readings.id"], name="notifications_reading_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], name="notifications_recipient_user_id_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_notifications_coop_created", "notifications", ["cooperative_id", "created_at"])
    op.create_index("ix_notifications_cooler_type", "notifications", ["cooler_id", "type", "created_at"])
    op.create_index("ix_notifications_status_next", "notifications", ["status", "next_attempt_at"])

    if not context.is_offline_mode():
        _backfill_change_log()


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("cooler_readings")
    op.drop_table("sensor_devices")

    for table in reversed(VERSIONED):
        with op.batch_alter_table(table) as batch:
            if table == "milk_collections":
                batch.drop_constraint("milk_collections_device_id_fkey", type_="foreignkey")
                batch.drop_column("client_recorded_at")
                batch.drop_column("device_id")
            batch.drop_column("sync_version")

    with op.batch_alter_table("coolers") as batch:
        batch.drop_constraint("coolers_manager_user_id_fkey", type_="foreignkey")
        for column in (
            "sync_version", "alerts_enabled", "low_battery_percent", "stale_after_minutes", "max_temperature_c",
            "min_temperature_c", "high_volume_alert_litres", "low_volume_alert_litres", "last_seen_at",
            "current_volume_litres", "manager_user_id",
        ):
            batch.drop_column(column)

    with op.batch_alter_table("cooperatives") as batch:
        batch.drop_column("alert_sms_enabled")

    op.drop_table("sync_changes")
    op.drop_table("sync_mutations")
    op.drop_table("device_sessions")
    op.drop_table("devices")
