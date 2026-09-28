from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from models.admin import CooperativeApplication, SMSCreditPayment, Cooler, AuditLog
from schemas.auth import UserRole
from routers.auth import require_roles, get_current_user

router = APIRouter(prefix="/api/v1/superadmin", tags=["Super Admin"])

# Security Guard: Only users with SUPER_ADMIN role can execute these endpoints
superadmin_only = Depends(require_roles([UserRole.SUPER_ADMIN]))

class ActionPayload(BaseModel):
    action: str  # "APPROVE" | "REJECT" | "VERIFY"

@router.get("/stats", dependencies=[superadmin_only])
def get_superadmin_stats(db: Session = Depends(get_db)):
    total_cooperatives = db.query(func.count(User.cooperative_id.distinct())).scalar() or 0
    total_coolers = db.query(Cooler).count()
    total_farmers = db.query(User).filter(User.role == UserRole.FARMER).count()
    pending_apps = db.query(CooperativeApplication).filter(CooperativeApplication.status == "PENDING").count()
    pending_pays = db.query(SMSCreditPayment).filter(SMSCreditPayment.status == "PENDING").count()

    return {
        "total_cooperatives": total_cooperatives,
        "total_coolers": total_coolers,
        "total_farmers": total_farmers,
        "milk_today_kg": 0.0,
        "pending_applications_count": pending_apps,
        "pending_payments_count": pending_pays,
    }

@router.get("/applications/pending", dependencies=[superadmin_only])
def get_pending_applications(db: Session = Depends(get_db)):
    return db.query(CooperativeApplication).filter(CooperativeApplication.status == "PENDING").all()

@router.get("/payments/pending", dependencies=[superadmin_only])
def get_pending_payments(db: Session = Depends(get_db)):
    return db.query(SMSCreditPayment).filter(SMSCreditPayment.status == "PENDING").all()

@router.post("/applications/{app_id}/action", dependencies=[superadmin_only])
def process_application_action(
    app_id: str, 
    payload: ActionPayload, 
    db: Session = Depends(get_db)
):
    app_record = db.query(CooperativeApplication).filter(CooperativeApplication.id == app_id).first()
    if not app_record:
        raise HTTPException(status_code=404, detail="Application record not found")

    if payload.action not in ["APPROVE", "REJECT"]:
        raise HTTPException(status_code=400, detail="Invalid action type")

    try:
        app_record.status = "APPROVED" if payload.action == "APPROVE" else "REJECTED"
        db.commit()
        return {"success": True, "application_id": app_id, "status": app_record.status}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

@router.post("/payments/{payment_id}/action", dependencies=[superadmin_only])
def verify_payment_action(
    payment_id: str, 
    payload: ActionPayload, 
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    payment = db.query(SMSCreditPayment).filter(SMSCreditPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")

    if payload.action not in ["VERIFY", "REJECT"]:
        raise HTTPException(status_code=400, detail="Invalid action type")

    try:
        if payload.action == "VERIFY":
            payment.status = "VERIFIED"
        else:
            payment.status = "REJECTED"

        db.commit()
        return {"success": True, "payment_id": payment_id, "status": payment.status}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Payment verification failed: {str(e)}")