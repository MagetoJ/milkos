"""Collection batches with multi-farmer allocation, corrections/reversals, SMS credit ledger, milk pricing,
farmer payments and the in-app notification center.

Existing data is preserved:
- Every existing milk_collections row becomes the single allocation line of a new CONFIRMED batch whose id
  is the collection's own id. Its weight in KG is derived from the recorded litres with the density factor
  LEGACY_DENSITY, stored on the batch (density_kg_per_litre) and flagged weight_source = 'LITRES' so the
  derivation is never mistaken for a scale reading. quantity_litres is not touched.
- Each cooperative's current sms_credit_balance becomes an opening ADJUSTMENT entry in the new ledger
  (reference OPENING-BALANCE-0007), so the derived balance equals the old column exactly.
- The new batches are added to the sync change log, so devices receive them on their next pull.

Revision ID: 0007_batches_finance
Revises: 0006_offline_sync
Create Date: 2026-10-04
"""
import datetime
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0007_batches_finance"
down_revision: Union[str, Sequence[str], None] = "0006_offline_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
NOW = sa.text("CURRENT_TIMESTAMP")
LEGACY_DENSITY = Decimal("1.0300")  # kg per litre of whole milk, used only to express legacy litres in KG
CENT = Decimal("0.01")


def _uuid_default():
    return sa.text("gen_random_uuid()") if context.get_context().dialect.name == "postgresql" else None


def _backfill_batches() -> None:
    bind = op.get_bind()
    mc = sa.table(
        "milk_collections",
        sa.column("id", sa.Uuid()), sa.column("reference", sa.String()), sa.column("cooperative_id", sa.Uuid()),
        sa.column("centre_id", sa.Uuid()), sa.column("cooler_id", sa.Uuid()), sa.column("collector_id", sa.Uuid()),
        sa.column("recorded_by", sa.Uuid()), sa.column("device_id", sa.Uuid()),
        sa.column("collection_date", sa.Date()), sa.column("collection_time", sa.Time()),
        sa.column("quantity_litres", sa.Numeric(10, 2)), sa.column("temperature_c", sa.Numeric(5, 2)),
        sa.column("notes", sa.Text()), sa.column("client_recorded_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()), sa.column("batch_id", sa.Uuid()),
        sa.column("quantity_kg", sa.Numeric(10, 2)),
    )
    batches = sa.table(
        "collection_batches",
        sa.column("id", sa.Uuid()), sa.column("reference", sa.String()), sa.column("cooperative_id", sa.Uuid()),
        sa.column("centre_id", sa.Uuid()), sa.column("cooler_id", sa.Uuid()), sa.column("collector_id", sa.Uuid()),
        sa.column("recorded_by", sa.Uuid()), sa.column("device_id", sa.Uuid()), sa.column("status", sa.String()),
        sa.column("collection_date", sa.Date()), sa.column("collection_time", sa.Time()),
        sa.column("captured_weight_kg", sa.Numeric(10, 2)), sa.column("allocated_weight_kg", sa.Numeric(10, 2)),
        sa.column("weight_source", sa.String()), sa.column("density_kg_per_litre", sa.Numeric(6, 4)),
        sa.column("temperature_c", sa.Numeric(5, 2)), sa.column("notes", sa.Text()),
        sa.column("confirmed_at", sa.DateTime()), sa.column("client_recorded_at", sa.DateTime()),
        sa.column("send_receipts", sa.Boolean()), sa.column("sync_version", sa.Integer()),
        sa.column("created_at", sa.DateTime()), sa.column("updated_at", sa.DateTime()),
    )
    changes = sa.table(
        "sync_changes",
        sa.column("cooperative_id", sa.Uuid()), sa.column("entity_type", sa.String()),
        sa.column("entity_id", sa.String()), sa.column("changed_at", sa.DateTime()),
    )
    rows = bind.execute(sa.select(
        mc.c.id, mc.c.reference, mc.c.cooperative_id, mc.c.centre_id, mc.c.cooler_id, mc.c.collector_id,
        mc.c.recorded_by, mc.c.device_id, mc.c.collection_date, mc.c.collection_time, mc.c.quantity_litres,
        mc.c.temperature_c, mc.c.notes, mc.c.client_recorded_at, mc.c.created_at,
    )).fetchall()
    now = datetime.datetime.utcnow()
    batch_rows, line_updates, change_rows = [], [], []
    for r in rows:
        kg = max((Decimal(str(r.quantity_litres)) * LEGACY_DENSITY).quantize(CENT, rounding=ROUND_HALF_UP), CENT)
        ref = r.reference or ""
        batch_rows.append({
            "id": r.id,
            "reference": ("CB-" + ref[3:]) if ref.startswith("MC-") else f"CB-{ref}"[:40],
            "cooperative_id": r.cooperative_id, "centre_id": r.centre_id, "cooler_id": r.cooler_id,
            "collector_id": r.collector_id, "recorded_by": r.recorded_by, "device_id": r.device_id,
            "status": "CONFIRMED", "collection_date": r.collection_date, "collection_time": r.collection_time,
            "captured_weight_kg": kg, "allocated_weight_kg": kg, "weight_source": "LITRES",
            "density_kg_per_litre": LEGACY_DENSITY, "temperature_c": r.temperature_c,
            "notes": "Migrated from a single-farmer collection recorded in litres.",
            "confirmed_at": r.created_at, "client_recorded_at": r.client_recorded_at, "send_receipts": False,
            "sync_version": 1, "created_at": r.created_at or now, "updated_at": now,
        })
        line_updates.append({"b_id": r.id, "b_kg": kg})
        change_rows.append({"cooperative_id": r.cooperative_id, "entity_type": "collection_batch",
                            "entity_id": str(r.id), "changed_at": now})
    if batch_rows:
        bind.execute(batches.insert(), batch_rows)
        bind.execute(
            mc.update().where(mc.c.id == sa.bindparam("b_id")).values(
                batch_id=sa.bindparam("b_id"), quantity_kg=sa.bindparam("b_kg"),
            ),
            line_updates,
        )
        bind.execute(changes.insert(), change_rows)


def _backfill_opening_balances() -> None:
    bind = op.get_bind()
    coops = sa.table("cooperatives", sa.column("id", sa.Uuid()), sa.column("sms_credit_balance", sa.Integer()))
    ledger = sa.table(
        "sms_credit_transactions",
        sa.column("id", sa.Uuid()), sa.column("cooperative_id", sa.Uuid()), sa.column("transaction_type", sa.String()),
        sa.column("amount", sa.Integer()), sa.column("reference", sa.String()), sa.column("reason", sa.Text()),
        sa.column("metadata", JSON_TYPE), sa.column("created_at", sa.DateTime()),
    )
    now = datetime.datetime.utcnow()
    rows = bind.execute(sa.select(coops.c.id, coops.c.sms_credit_balance).where(coops.c.sms_credit_balance != 0)).fetchall()
    if rows:
        bind.execute(ledger.insert(), [
            {
                "id": uuid.uuid4(), "cooperative_id": cid, "transaction_type": "ADJUSTMENT", "amount": int(balance),
                "reference": "OPENING-BALANCE-0007",
                "reason": "Opening balance carried over from cooperatives.sms_credit_balance when the ledger was introduced.",
                "metadata": {"migrated_from": "cooperatives.sms_credit_balance"}, "created_at": now,
            }
            for cid, balance in rows
        ])


def upgrade() -> None:
    uuid_default = _uuid_default()

    with op.batch_alter_table("cooperatives") as batch:
        batch.add_column(sa.Column("receipt_sms_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))

    # ---------------- collection batches ----------------
    op.create_table(
        "collection_batches",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("reference", sa.String(40), nullable=False),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("centre_id", sa.Uuid()),
        sa.Column("cooler_id", sa.Uuid()),
        sa.Column("collector_id", sa.Uuid()),
        sa.Column("recorded_by", sa.Uuid()),
        sa.Column("device_id", sa.Uuid()),
        sa.Column("status", sa.String(30), nullable=False, server_default="CONFIRMED"),
        sa.Column("collection_date", sa.Date(), nullable=False),
        sa.Column("collection_time", sa.Time(), nullable=False),
        sa.Column("captured_weight_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("allocated_weight_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("tare_weight_kg", sa.Numeric(10, 2)),
        sa.Column("weight_source", sa.String(20), nullable=False),
        sa.Column("scale_name", sa.String(255)),
        sa.Column("scale_identifier", sa.String(255)),
        sa.Column("density_kg_per_litre", sa.Numeric(6, 4), nullable=False),
        sa.Column("temperature_c", sa.Numeric(5, 2)),
        sa.Column("notes", sa.Text()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("captured_at", sa.DateTime()),
        sa.Column("confirmed_at", sa.DateTime()),
        sa.Column("client_recorded_at", sa.DateTime()),
        sa.Column("send_receipts", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("supersedes_batch_id", sa.Uuid()),
        sa.Column("superseded_by_batch_id", sa.Uuid()),
        sa.Column("sync_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="collection_batches_pkey"),
        sa.UniqueConstraint("reference", name="collection_batches_reference_key"),
        sa.CheckConstraint("captured_weight_kg > 0", name="ck_collection_batches_captured_positive"),
        sa.CheckConstraint("allocated_weight_kg > 0", name="ck_collection_batches_allocated_positive"),
        sa.CheckConstraint("allocated_weight_kg <= captured_weight_kg", name="ck_collection_batches_not_over_allocated"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="collection_batches_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["centre_id"], ["collection_centres.id"], name="collection_batches_centre_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cooler_id"], ["coolers.id"], name="collection_batches_cooler_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["collector_id"], ["collectors.id"], name="collection_batches_collector_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], name="collection_batches_recorded_by_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], name="collection_batches_device_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supersedes_batch_id"], ["collection_batches.id"], name="collection_batches_supersedes_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["superseded_by_batch_id"], ["collection_batches.id"], name="collection_batches_superseded_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_collection_batches_coop_date", "collection_batches", ["cooperative_id", "collection_date"])
    op.create_index("ix_collection_batches_collector", "collection_batches", ["collector_id", "collection_date"])
    op.create_index("ix_collection_batches_cooler", "collection_batches", ["cooler_id"])
    op.create_index("ix_collection_batches_centre", "collection_batches", ["centre_id"])
    op.create_index("ix_collection_batches_coop_status", "collection_batches", ["cooperative_id", "status"])
    op.create_index("ix_collection_batches_device", "collection_batches", ["device_id"])

    with op.batch_alter_table("milk_collections") as batch:
        batch.add_column(sa.Column("batch_id", sa.Uuid()))
        batch.add_column(sa.Column("quantity_kg", sa.Numeric(10, 2)))
        batch.add_column(sa.Column("record_status", sa.String(20), nullable=False, server_default="ACTIVE"))

    if not context.is_offline_mode():
        _backfill_batches()

    with op.batch_alter_table("milk_collections") as batch:
        batch.alter_column("batch_id", existing_type=sa.Uuid(), nullable=False)
        batch.alter_column("quantity_kg", existing_type=sa.Numeric(10, 2), nullable=False)
        batch.create_foreign_key(
            "milk_collections_batch_id_fkey", "collection_batches", ["batch_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_check_constraint("ck_milk_collections_kg_positive", "quantity_kg > 0")
    op.create_index("ix_milk_collections_batch", "milk_collections", ["batch_id"])
    op.create_index("ix_milk_collections_centre", "milk_collections", ["centre_id"])
    op.create_index("ix_milk_collections_device", "milk_collections", ["device_id"])
    op.create_index("uq_milk_collections_batch_farmer", "milk_collections", ["batch_id", "farmer_id"], unique=True)

    op.create_table(
        "collection_correction_requests",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("request_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("original_values", JSON_TYPE, nullable=False),
        sa.Column("proposed_values", JSON_TYPE),
        sa.Column("requested_by", sa.Uuid()),
        sa.Column("requested_role", sa.String(30)),
        sa.Column("reviewed_by", sa.Uuid()),
        sa.Column("reviewed_at", sa.DateTime()),
        sa.Column("review_comment", sa.Text()),
        sa.Column("resulting_batch_id", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="collection_correction_requests_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="collection_correction_requests_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["batch_id"], ["collection_batches.id"], name="collection_correction_requests_batch_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], name="collection_correction_requests_requested_by_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], name="collection_correction_requests_reviewed_by_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resulting_batch_id"], ["collection_batches.id"], name="collection_correction_requests_resulting_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_correction_requests_coop_status", "collection_correction_requests", ["cooperative_id", "status", "created_at"])
    op.create_index("ix_correction_requests_batch", "collection_correction_requests", ["batch_id"])
    op.create_index(
        "uq_correction_requests_batch_pending", "collection_correction_requests", ["batch_id"], unique=True,
        postgresql_where=sa.text("status = 'PENDING'"), sqlite_where=sa.text("status = 'PENDING'"),
    )

    # ---------------- SMS credit ledger ----------------
    op.create_table(
        "sms_credit_transactions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("reference", sa.String(120), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("actor_user_id", sa.Uuid()),
        sa.Column("metadata", JSON_TYPE),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="sms_credit_transactions_pkey"),
        sa.CheckConstraint("amount <> 0", name="ck_sms_credit_transactions_nonzero"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="sms_credit_transactions_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], name="sms_credit_transactions_actor_user_id_fkey", ondelete="SET NULL"),
    )
    op.create_index("uq_sms_credit_txn_coop_type_ref", "sms_credit_transactions", ["cooperative_id", "transaction_type", "reference"], unique=True)
    op.create_index("ix_sms_credit_txn_coop_created", "sms_credit_transactions", ["cooperative_id", "created_at"])
    if not context.is_offline_mode():
        _backfill_opening_balances()

    with op.batch_alter_table("notifications") as batch:
        batch.add_column(sa.Column("collection_id", sa.Uuid()))
        batch.add_column(sa.Column("farmer_id", sa.Uuid()))
        batch.add_column(sa.Column("idempotency_key", sa.String(120)))
        batch.create_foreign_key("notifications_collection_id_fkey", "milk_collections", ["collection_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("notifications_farmer_id_fkey", "farmers", ["farmer_id"], ["id"], ondelete="SET NULL")
        batch.create_unique_constraint("notifications_idempotency_key_key", ["idempotency_key"])
    op.create_index("ix_notifications_collection_id", "notifications", ["collection_id"])

    # ---------------- pricing & farmer payments ----------------
    op.create_table(
        "milk_prices",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date()),
        sa.Column("price_per_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="KES"),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("cancelled_by", sa.Uuid()),
        sa.Column("cancelled_at", sa.DateTime()),
        sa.Column("cancel_reason", sa.Text()),
        sa.PrimaryKeyConstraint("id", name="milk_prices_pkey"),
        sa.CheckConstraint("price_per_kg > 0", name="ck_milk_prices_positive"),
        sa.CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_milk_prices_window"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="milk_prices_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="milk_prices_created_by_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cancelled_by"], ["users.id"], name="milk_prices_cancelled_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_milk_prices_coop_from", "milk_prices", ["cooperative_id", "effective_from"])

    op.create_table(
        "farmer_payments",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("reference", sa.String(40), nullable=False),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("farmer_id", sa.Uuid(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("total_kg", sa.Numeric(12, 2), nullable=False),
        sa.Column("average_price_per_kg", sa.Numeric(10, 4)),
        sa.Column("gross_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("adjustments_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("net_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="KES"),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("payment_method", sa.String(20)),
        sa.Column("payment_account", sa.String(100)),
        sa.Column("payment_reference", sa.String(100)),
        sa.Column("provider", sa.String(50)),
        sa.Column("failure_reason", sa.Text()),
        sa.Column("paid_at", sa.DateTime()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="farmer_payments_pkey"),
        sa.UniqueConstraint("reference", name="farmer_payments_reference_key"),
        sa.CheckConstraint("period_end >= period_start", name="ck_farmer_payments_period"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="farmer_payments_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["farmer_id"], ["farmers.id"], name="farmer_payments_farmer_id_fkey", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="farmer_payments_created_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_farmer_payments_coop_period", "farmer_payments", ["cooperative_id", "period_start", "period_end"])
    op.create_index("ix_farmer_payments_farmer", "farmer_payments", ["farmer_id", "period_start"])
    op.create_index("ix_farmer_payments_coop_status", "farmer_payments", ["cooperative_id", "status"])
    op.create_index(
        "uq_farmer_payments_farmer_period_open", "farmer_payments", ["farmer_id", "period_start", "period_end"], unique=True,
        postgresql_where=sa.text("status <> 'CANCELLED'"), sqlite_where=sa.text("status <> 'CANCELLED'"),
    )

    op.create_table(
        "farmer_payment_lines",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("collection_id", sa.Uuid(), nullable=False),
        sa.Column("collection_date", sa.Date(), nullable=False),
        sa.Column("quantity_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("price_id", sa.Uuid(), nullable=False),
        sa.Column("price_per_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id", name="farmer_payment_lines_pkey"),
        sa.ForeignKeyConstraint(["payment_id"], ["farmer_payments.id"], name="farmer_payment_lines_payment_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["collection_id"], ["milk_collections.id"], name="farmer_payment_lines_collection_id_fkey", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["price_id"], ["milk_prices.id"], name="farmer_payment_lines_price_id_fkey", ondelete="RESTRICT"),
    )
    op.create_index("ix_farmer_payment_lines_payment", "farmer_payment_lines", ["payment_id"])
    op.create_index(
        "uq_farmer_payment_lines_collection_active", "farmer_payment_lines", ["collection_id"], unique=True,
        postgresql_where=sa.text("is_active"), sqlite_where=sa.text("is_active = 1"),
    )

    op.create_table(
        "farmer_payment_adjustments",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid(), nullable=False),
        sa.Column("farmer_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", sa.Uuid()),
        sa.Column("collection_id", sa.Uuid()),
        sa.Column("original_payment_id", sa.Uuid()),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("applied_payment_id", sa.Uuid()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(), server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="farmer_payment_adjustments_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="farmer_payment_adjustments_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["farmer_id"], ["farmers.id"], name="farmer_payment_adjustments_farmer_id_fkey", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["collection_id"], ["milk_collections.id"], name="farmer_payment_adjustments_collection_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["original_payment_id"], ["farmer_payments.id"], name="farmer_payment_adjustments_original_payment_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["applied_payment_id"], ["farmer_payments.id"], name="farmer_payment_adjustments_applied_payment_id_fkey", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="farmer_payment_adjustments_created_by_fkey", ondelete="SET NULL"),
    )
    op.create_index("ix_farmer_payment_adjustments_farmer_status", "farmer_payment_adjustments", ["farmer_id", "status"])
    op.create_index("ix_farmer_payment_adjustments_coop", "farmer_payment_adjustments", ["cooperative_id", "created_at"])

    # ---------------- in-app notification center ----------------
    op.create_table(
        "inbox_notifications",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("cooperative_id", sa.Uuid()),
        sa.Column("recipient_user_id", sa.Uuid()),
        sa.Column("audience_roles", sa.String(120)),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="INFO"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String(64)),
        sa.Column("link", sa.String(300)),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="inbox_notifications_pkey"),
        sa.ForeignKeyConstraint(["cooperative_id"], ["cooperatives.id"], name="inbox_notifications_cooperative_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], name="inbox_notifications_recipient_user_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_inbox_coop_created", "inbox_notifications", ["cooperative_id", "created_at"])
    op.create_index("ix_inbox_recipient_created", "inbox_notifications", ["recipient_user_id", "created_at"])
    op.create_index("ix_inbox_entity", "inbox_notifications", ["entity_type", "entity_id", "type"])

    op.create_table(
        "inbox_reads",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=uuid_default),
        sa.Column("notification_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("id", name="inbox_reads_pkey"),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_inbox_reads_notification_user"),
        sa.ForeignKeyConstraint(["notification_id"], ["inbox_notifications.id"], name="inbox_reads_notification_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="inbox_reads_user_id_fkey", ondelete="CASCADE"),
    )
    op.create_index("ix_inbox_reads_user_id", "inbox_reads", ["user_id"])


def downgrade() -> None:
    """Removes the new tables and columns. Batches created by corrections and the ledger history are lost;
    the per-farmer milk_collections rows (and their litres) remain."""
    op.drop_table("inbox_reads")
    op.drop_table("inbox_notifications")
    op.drop_table("farmer_payment_adjustments")
    op.drop_table("farmer_payment_lines")
    op.drop_table("farmer_payments")
    op.drop_table("milk_prices")

    op.drop_index("ix_notifications_collection_id", table_name="notifications")
    with op.batch_alter_table("notifications") as batch:
        batch.drop_constraint("notifications_idempotency_key_key", type_="unique")
        batch.drop_constraint("notifications_farmer_id_fkey", type_="foreignkey")
        batch.drop_constraint("notifications_collection_id_fkey", type_="foreignkey")
        batch.drop_column("idempotency_key")
        batch.drop_column("farmer_id")
        batch.drop_column("collection_id")

    op.drop_table("sms_credit_transactions")
    op.drop_table("collection_correction_requests")

    op.drop_index("uq_milk_collections_batch_farmer", table_name="milk_collections")
    op.drop_index("ix_milk_collections_device", table_name="milk_collections")
    op.drop_index("ix_milk_collections_centre", table_name="milk_collections")
    op.drop_index("ix_milk_collections_batch", table_name="milk_collections")
    with op.batch_alter_table("milk_collections") as batch:
        batch.drop_constraint("ck_milk_collections_kg_positive", type_="check")
        batch.drop_constraint("milk_collections_batch_id_fkey", type_="foreignkey")
        batch.drop_column("record_status")
        batch.drop_column("quantity_kg")
        batch.drop_column("batch_id")
    op.execute("DELETE FROM sync_changes WHERE entity_type = 'collection_batch'")
    op.drop_table("collection_batches")

    with op.batch_alter_table("cooperatives") as batch:
        batch.drop_column("receipt_sms_enabled")
