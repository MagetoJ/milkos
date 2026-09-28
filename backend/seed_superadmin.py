import os
from sqlalchemy.orm import Session
from db import SessionLocal
from models.user import User
from schemas.auth import UserRole
from core.security import hash_password

def seed_superadmin():
    db: Session = SessionLocal()
    try:
        superadmin_email = os.getenv("SUPERADMIN_EMAIL", "superadmin@milkflow.com")
        superadmin_password = os.getenv("SUPERADMIN_PASSWORD", "SuperAdmin#2026Pass")

        existing_admin = db.query(User).filter(User.email == superadmin_email).first()
        if not existing_admin:
            admin_user = User(
                email=superadmin_email,
                password_hash=hash_password(superadmin_password),
                full_name="Platform Super Admin",
                phone_number="+254700000000",
                role=UserRole.SUPER_ADMIN,
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print(f"[SUCCESS] Superadmin seeded successfully: {superadmin_email}")
        else:
            print("[INFO] Superadmin account already exists.")
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Seeding failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_superadmin()