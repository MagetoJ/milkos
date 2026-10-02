"""Per-cooperative uniqueness for centre codes and farmer number / phone / national ID.

Only adds unique indexes. The farmers and collection_centres tables were created in 0003 and
nothing wrote to them before the cooperative module, so existing data cannot violate them.

Revision ID: 0004_cooperative_uniques
Revises: 0003_farmers_centres
Create Date: 2026-10-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004_cooperative_uniques"
down_revision: Union[str, Sequence[str], None] = "0003_farmers_centres"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("uq_centres_cooperative_code", "collection_centres", ["cooperative_id", "code"], unique=True)
    op.create_index("uq_farmers_cooperative_number", "farmers", ["cooperative_id", "farmer_number"], unique=True)
    op.create_index("uq_farmers_cooperative_phone", "farmers", ["cooperative_id", "phone"], unique=True)
    op.create_index("uq_farmers_cooperative_national_id", "farmers", ["cooperative_id", "national_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_farmers_cooperative_national_id", table_name="farmers")
    op.drop_index("uq_farmers_cooperative_phone", table_name="farmers")
    op.drop_index("uq_farmers_cooperative_number", table_name="farmers")
    op.drop_index("uq_centres_cooperative_code", table_name="collection_centres")