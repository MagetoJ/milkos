import asyncio
import os
import sys

from sqlalchemy import select
from app.core.security import hash_password
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.db.models.user import User


async def seed_superadmin() -> int:
    superadmin_email = os.getenv("SUPERADMIN_EMAIL", "superadmin@milkflow.com").strip().lower()
    superadmin_password = os.getenv("SUPERADMIN_PASSWORD", "")

    if not superadmin_password:
        print(
            "[ERROR] SUPERADMIN_PASSWORD is not set in backend/.env.",
            file=sys.stderr,
        )
        return 1

    async with AsyncSessionLocal() as db:
        try:
            # Query existing user asynchronously
            stmt = select(User).where(User.email == superadmin_email)
            result = await db.execute(stmt)
            existing_admin = result.scalar_one_or_none()

            if existing_admin:
                print("[INFO] Superadmin account already exists.")
                return 0

            new_superadmin = User(
                email=superadmin_email,
                password_hash=hash_password(superadmin_password),
                full_name="Platform Super Admin",
                phone_number="+254700000000",
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )

            db.add(new_superadmin)
            await db.commit()
            print(f"[SUCCESS] Superadmin seeded successfully: {superadmin_email}")
            return 0

        except Exception as e:
            await db.rollback()
            print(f"[ERROR] Seeding failed: {e}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(seed_superadmin()))