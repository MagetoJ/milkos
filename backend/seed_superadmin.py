import os
import sys

from sqlalchemy.orm import Session

from core.security import hash_password
from db import SessionLocal
from models.user import User
from schemas.auth import UserRole


def seed_superadmin() -> int:
    superadmin_email = os.getenv("SUPERADMIN_EMAIL", "superadmin@milkflow.com").strip().lower()
    superadmin_password = os.getenv("SUPERADMIN_PASSWORD", "")

    db: Session = SessionLocal()
    try:
        existing_admin = db.query(User).filter(User.email == superadmin_email).first()
        if existing_admin:
            print("[INFO] Superadmin account already exists.")
            return 0

        if not superadmin_password:
            print(
                "[ERROR] SUPERADMIN_PASSWORD is not set, so the superadmin cannot be created. "
                "Set it in backend/.env.",
                file=sys.stderr,
            )
            return 1

        db.add(User(
            email=superadmin_email,
            password_hash=hash_password(superadmin_password),
            full_name="Platform Super Admin",
            phone_number="+254700000000",
            role=UserRole.SUPER_ADMIN,
            is_active=True,
        ))
        db.commit()
        print(f"[SUCCESS] Superadmin seeded successfully: {superadmin_email}")
        return 0
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Seeding failed: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(seed_superadmin())
