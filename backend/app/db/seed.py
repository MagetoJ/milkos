import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.database import AsyncSessionLocal
from app.models.tenant import Cooperative
from app.models.centre import CollectionCentre, CoolingUnit
from app.models.pricing import BasePricing, QualityDeduction
from app.models.user import User, UserRole
from app.core.security import get_password_hash

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def seed_database(db: AsyncSession):
    logger.info("Starting database seeding...")

    # 1. Create Superadmin Tenant / Platform Tenant
    platform_coop = Cooperative(
        name="MilkOS Platform Admin",
        slug="platform-admin",
        is_active=True,
    )
    db.add(platform_coop)
    await db.flush()

    # 2. Create Test Cooperative Tenant
    test_coop = Cooperative(
        name="Limuru Dairy Farmers Co-op",
        slug="limuru-dairy",
        is_active=True,
    )
    db.add(test_coop)
    await db.flush()

    # 3. Users (Superadmin, Co-op Admin, Collector, Farmer)
    hashed_password = get_password_hash("MilkOS@2026Test!")

    users = [
        User(
            email="admin@milkos.internal",
            hashed_password=hashed_password,
            full_name="Platform Superadmin",
            role=UserRole.SUPERADMIN,
            cooperative_id=platform_coop.id,
            is_active=True,
            is_verified=True,
        ),
        User(
            email="manager@limurudairy.co.ke",
            hashed_password=hashed_password,
            full_name="Limuru Admin",
            role=UserRole.COOP_ADMIN,
            cooperative_id=test_coop.id,
            is_active=True,
            is_verified=True,
        ),
        User(
            email="collector1@limurudairy.co.ke",
            hashed_password=hashed_password,
            full_name="John Doe (Collector)",
            role=UserRole.COLLECTOR,
            cooperative_id=test_coop.id,
            is_active=True,
            is_verified=True,
        ),
        User(
            email="farmer1@limurudairy.co.ke",
            hashed_password=hashed_password,
            full_name="Jane Wanjiku (Farmer)",
            role=UserRole.FARMER,
            cooperative_id=test_coop.id,
            is_active=True,
            is_verified=True,
        ),
    ]
    db.add_all(users)
    await db.flush()

    # 4. Collection Centre & Cooling Unit
    centre = CollectionCentre(
        name="Central Collection Hub",
        code="HUB-001",
        cooperative_id=test_coop.id,
        is_active=True,
    )
    db.add(centre)
    await db.flush()

    cooler = CoolingUnit(
        name="Cooler Tank Alpha (2000L)",
        code="CT-A1",
        capacity_liters=2000.0,
        current_volume_liters=0.0,
        target_temp_celsius=4.0,
        centre_id=centre.id,
        is_active=True,
    )
    db.add(cooler)

    # 5. Pricing Configuration
    pricing = BasePricing(
        cooperative_id=test_coop.id,
        price_per_liter=52.00,  # KES 52.00 / Liter base price
        effective_from=datetime.now(timezone.utc),
        is_active=True,
    )
    db.add(pricing)
    await db.flush()

    deduction = QualityDeduction(
        cooperative_id=test_coop.id,
        parameter_name="high_lactometer_density",
        deduction_per_unit=2.50,
        min_threshold=26.0,
        max_threshold=32.0,
        is_active=True,
    )
    db.add(deduction)

    await db.commit()
    logger.info("Database seeding completed successfully.")


async def main():
    async with AsyncSessionLocal() as session:
        await seed_database(session)


if __name__ == "__main__":
    asyncio.run(main())