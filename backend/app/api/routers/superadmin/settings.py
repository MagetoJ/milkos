"""Platform settings, SMS credit packages and the (read-only) roles & permissions matrix."""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_superadmin
from app.api.dependencies.db import get_db
from app.core.permissions import ROLE_PERMISSIONS, Permission
from app.domain.schemas.platform import SettingsUpdate, SmsPackageCreate, SmsPackageUpdate
from app.services import settings
from app.services.platform_admin import billing
from app.services.principal import Principal

router = APIRouter()


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return settings.list_all(db)


@router.put("/settings")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    admin.require(Permission.SETTINGS_MANAGE)
    return settings.update(db, admin, payload.values)


@router.get("/roles")
def roles_and_permissions(_: Principal = Depends(require_superadmin)):
    return {
        "permissions": [p.value for p in Permission],
        "roles": {role.value: sorted(p.value for p in perms) for role, perms in ROLE_PERMISSIONS.items()},
    }


@router.get("/sms-packages")
def list_packages(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return billing.list_packages(db)


@router.post("/sms-packages", status_code=status.HTTP_201_CREATED)
def create_package(payload: SmsPackageCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    admin.require(Permission.SETTINGS_MANAGE)
    return billing.create_package(db, admin, payload)


@router.put("/sms-packages/{package_id}")
def update_package(
    package_id: str, payload: SmsPackageUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    admin.require(Permission.SETTINGS_MANAGE)
    return billing.update_package(db, admin, package_id, payload)
