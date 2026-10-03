"""Platform settings, SMS credit packages and the (read-only) roles & permissions matrix."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.access import Principal, require_superadmin
from core.permissions import ROLE_PERMISSIONS, Permission
from core.utils import changed, num, parse_uuid, reject_nulls, snapshot
from db import get_db
from models.admin import SMSCreditPackage
from schemas.platform import SettingsUpdate, SmsPackageCreate, SmsPackageUpdate
from services import audit, settings

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


def _package_json(p: SMSCreditPackage) -> dict:
    return {
        "id": str(p.id), "name": p.name, "credits_amount": p.credits_amount,
        "price_kes": num(p.price_kes), "is_active": bool(p.is_active),
    }


@router.get("/sms-packages")
def list_packages(db: Session = Depends(get_db), _: Principal = Depends(require_superadmin)):
    return [_package_json(p) for p in db.query(SMSCreditPackage).order_by(SMSCreditPackage.credits_amount).all()]


@router.post("/sms-packages", status_code=status.HTTP_201_CREATED)
def create_package(payload: SmsPackageCreate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)):
    admin.require(Permission.SETTINGS_MANAGE)
    package = SMSCreditPackage(**payload.model_dump())
    db.add(package)
    db.flush()
    audit.record(
        db, admin, "SMS_PACKAGE_CREATED", target=f"{package.name}: {package.credits_amount:,} credits for KES {payload.price_kes:,.0f}",
        entity_type="sms_package", entity_id=package.id, new_values=payload.model_dump(),
    )
    db.commit()
    db.refresh(package)
    return _package_json(package)


@router.put("/sms-packages/{package_id}")
def update_package(
    package_id: str, payload: SmsPackageUpdate, db: Session = Depends(get_db), admin: Principal = Depends(require_superadmin)
):
    admin.require(Permission.SETTINGS_MANAGE)
    package = db.get(SMSCreditPackage, parse_uuid(package_id, "Package"))
    if package is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package not found")
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "name", "credits_amount", "price_kes", "is_active")
    fields = ("name", "credits_amount", "price_kes", "is_active")
    before = snapshot(package, fields)
    for name, value in data.items():
        setattr(package, name, value)
    old, new = changed(before, snapshot(package, fields))
    if new:
        audit.record(
            db, admin, "SMS_PACKAGE_UPDATED", target=package.name, entity_type="sms_package", entity_id=package.id,
            old_values=old, new_values=new,
        )
        db.commit()
    db.refresh(package)
    return _package_json(package)
