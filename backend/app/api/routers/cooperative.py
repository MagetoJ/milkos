"""Cooperative workspace API: overview, collection centres, farmers, team, collectors, coolers, activity,
SMS credits, and cooler monitoring (readings, sensors, alert notifications) and the cooperative's devices.

Every endpoint works on the logged-in user's own cooperative (users.cooperative_id). The cooperative is
never taken from the URL; a body naming a different cooperative is refused. One cooperative therefore
cannot read or change another's data. Access is checked by app.api.dependencies.auth against the database.

  COOP_ADMIN  everything below
  MANAGER     read everything; create and edit centres, farmers, collector assignments and coolers;
              cannot change the team or decommission equipment
"""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_permission, require_roles
from app.api.dependencies.db import get_db
from app.api.dependencies.pagination import page_params
from app.core.permissions import Permission
from app.domain.schemas.auth import UserRole
from app.domain.schemas.cooperative_module import (
    CentreCreate, CentreUpdate, FarmerCreate, FarmerUpdate, TeamCreate, TeamUpdate,
)
from app.domain.schemas.platform import CollectorCreate, CollectorUpdate, CoolerCreate, CoolerUpdate, SmsTopUpCreate
from app.domain.schemas.sync import DeviceUpdate, SensorCreate, SensorUpdate
from app.infrastructure.db.models.admin import Cooler, SMSCreditPayment
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.notifications import Notification
from app.infrastructure.db.models.operations import Collector
from app.infrastructure.db.models.sensors import SensorDevice
from app.infrastructure.db.models.sync import Device
from app.infrastructure.db.models.user import User
from app.infrastructure.db.pagination import PageParams
from app.services import (
    accounts, audit, centres, collectors, cooler_readings, coolers, coop_dashboard, farmers, notifications, payments,
    sensors, team,
)
from app.services.principal import Principal, own
from app.services.sync import devices

router = APIRouter(prefix="/api/v1/cooperative", tags=["Cooperative"])


# ---------------- who is calling ----------------

staff = require_roles(UserRole.COOP_ADMIN, UserRole.MANAGER)
admin_only = require_roles(UserRole.COOP_ADMIN)


def _staff_with(permission: Permission):
    """Workspace staff (COOP_ADMIN / MANAGER) holding `permission`."""

    def dependency(principal: Principal = Depends(staff)) -> Principal:
        principal.require(permission)
        return principal

    return dependency


# ---------------- overview ----------------

@router.get("/overview")
def overview(principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    return coop_dashboard.overview(db, principal.cooperative, principal.role)


# ---------------- collection centres ----------------

@router.get("/centres")
def list_centres(principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    return centres.list_for(db, principal.cooperative.id)


@router.post("/centres", status_code=status.HTTP_201_CREATED)
def create_centre(payload: CentreCreate, principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    return centres.serialize(db, [centres.create(db, principal, payload)])[0]


@router.patch("/centres/{centre_id}")
def update_centre(centre_id: str, payload: CentreUpdate, principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    centre = own(db, principal, CollectionCentre, centre_id, "Collection centre")
    return centres.serialize(db, [centres.update(db, principal, centre, payload)])[0]


# ---------------- farmers ----------------

@router.get("/farmers")
def list_farmers(
    search: Optional[str] = Query(None, max_length=100),
    centre_id: Optional[str] = Query(None, description="A centre id, or 'none' for farmers without a centre"),
    farmer_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    principal: Principal = Depends(staff),
    db: Session = Depends(get_db),
):
    return farmers.list_page(db, principal.cooperative.id, search, centre_id, farmer_status, page, page_size)


@router.post("/farmers", status_code=status.HTTP_201_CREATED)
def create_farmer(payload: FarmerCreate, principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    farmer, centre = farmers.create(db, principal, payload)
    return farmers.farmer_json(farmer, centre.name if centre else None)


@router.patch("/farmers/{farmer_id}")
def update_farmer(farmer_id: str, payload: FarmerUpdate, principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    farmer = farmers.update(db, principal, own(db, principal, Farmer, farmer_id, "Farmer"), payload)
    return farmers.json_with_centre(db, farmer)


# ---------------- team & accounts (see app.services.team) ----------------

def _member(db: Session, principal: Principal, user: User, sms=None) -> dict:
    """The member, with the outcome of the SMS this request sent them (if it sent one)."""
    out = team.member_json(db, user, principal.user)
    if sms is not None:
        out["activation_sms"] = accounts.sms_outcome(sms)
    return out


def _invited(db: Session, principal: Principal, user: User, sms) -> dict:
    """The member and whether their activation link was texted (reported even when no SMS could be created)."""
    return {**team.member_json(db, user, principal.user), "activation_sms": accounts.sms_outcome(sms)}


@router.get("/team")
def list_team(principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    return [team.member_json(db, u, principal.user) for u in team.list_team(db, principal)]


@router.get("/accounts")
def list_accounts(
    role: Optional[UserRole] = None, account_status: Optional[str] = Query(None, max_length=30),
    search: Optional[str] = Query(None, max_length=100),
    principal: Principal = Depends(_staff_with(Permission.USER_READ)), db: Session = Depends(get_db),
):
    """Every sign-in account of this cooperative (staff and farmers) with its activation state."""
    return [team.member_json(db, u, principal.user) for u in team.list_accounts(db, principal, role, account_status, search)]


@router.post("/team", status_code=status.HTTP_201_CREATED)
def create_team_member(payload: TeamCreate, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    member, sms = team.create_member(db, principal, payload)
    return _invited(db, principal, member, sms)


@router.patch("/team/{member_id}")
def update_team_member(member_id: str, payload: TeamUpdate, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    member, sms = team.update_member(db, principal, team.own_member(db, principal, member_id), payload)
    return _member(db, principal, member, sms)


class _StatusBody(BaseModel):
    status: Literal["ACTIVE", "SUSPENDED", "DISABLED"]
    reason: Optional[str] = Field(None, max_length=500)


class _ReasonBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


@router.post("/accounts/{account_id}/resend-activation")
def resend_account_activation(account_id: str, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    user = team.own_account(db, principal, account_id)
    sms = team.resend_activation(db, principal, user)
    return _invited(db, principal, user, sms)


@router.post("/accounts/{account_id}/revoke-invitation")
def revoke_account_invitation(account_id: str, body: Optional[_ReasonBody] = None, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    user = accounts.revoke_invitation(db, principal, team.own_account(db, principal, account_id), body.reason if body else None)
    return team.member_json(db, user, principal.user)


@router.post("/accounts/{account_id}/status")
def set_account_status(account_id: str, body: _StatusBody, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    user, sms = team.set_status(db, principal, team.own_account(db, principal, account_id), body.status, body.reason)
    return _member(db, principal, user, sms)


@router.post("/accounts/{account_id}/send-password-reset")
def send_account_password_reset(account_id: str, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    """Text the person a password reset link. The admin never sets, sees or receives the password."""
    sms = team.send_password_reset(db, principal, team.own_account(db, principal, account_id))
    return {"sent": True, **accounts.sms_outcome(sms)}


@router.post("/farmers/{farmer_id}/account", status_code=status.HTTP_201_CREATED)
def invite_farmer(farmer_id: str, principal: Principal = Depends(_staff_with(Permission.USER_CREATE)), db: Session = Depends(get_db)):
    """Give a farmer the MilkOS app: a FARMER account on the farmer's registered phone, activated by SMS link."""
    user, sms = team.invite_farmer(db, principal, own(db, principal, Farmer, farmer_id, "Farmer"))
    return _invited(db, principal, user, sms)


# ---------------- collectors ----------------

@router.get("/collectors")
def list_collectors(principal: Principal = Depends(_staff_with(Permission.COLLECTOR_READ)), db: Session = Depends(get_db)):
    return collectors.rows(db, principal.cooperative.id)


@router.post("/collectors", status_code=status.HTTP_201_CREATED)
def create_collector(
    payload: CollectorCreate, principal: Principal = Depends(_staff_with(Permission.COLLECTOR_CREATE)), db: Session = Depends(get_db)
):
    profile, pending = collectors.create(db, principal, payload)
    sms = accounts.dispatch(db, pending, ip=principal.ip_address, ua=principal.user_agent)
    return {**collectors.rows(db, principal.cooperative.id, profile.id)[0], "activation_sms": accounts.sms_outcome(sms)}


@router.patch("/collectors/{collector_id}")
def update_collector(
    collector_id: str, payload: CollectorUpdate,
    principal: Principal = Depends(_staff_with(Permission.COLLECTOR_UPDATE)), db: Session = Depends(get_db),
):
    profile = own(db, principal, Collector, collector_id, "Collector")
    if "status" in payload.model_fields_set:
        principal.require(Permission.COLLECTOR_DISABLE)
    profile = collectors.update(db, principal, profile, payload)
    return collectors.rows(db, principal.cooperative.id, profile.id)[0]


# ---------------- coolers ----------------

@router.get("/coolers")
def list_coolers(principal: Principal = Depends(require_permission(Permission.COOLER_READ)), db: Session = Depends(get_db)):
    return coolers.rows(db, principal.require_tenant().cooperative.id)


@router.post("/coolers", status_code=status.HTTP_201_CREATED)
def create_cooler(
    payload: CoolerCreate, principal: Principal = Depends(_staff_with(Permission.COOLER_CREATE)), db: Session = Depends(get_db)
):
    cooler = coolers.create(db, principal, payload)
    return coolers.rows(db, principal.cooperative.id, cooler.id)[0]


@router.patch("/coolers/{cooler_id}")
def update_cooler(
    cooler_id: str, payload: CoolerUpdate,
    principal: Principal = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db),
):
    cooler = own(db, principal, Cooler, cooler_id, "Cooler")
    if "status" in payload.model_fields_set:
        principal.require(Permission.COOLER_DISABLE)
    cooler = coolers.update(db, principal, cooler, payload)
    return coolers.rows(db, principal.cooperative.id, cooler.id)[0]


# ---------------- dashboard trends ----------------

@router.get("/trends")
def trends(
    range: str = Query("30d", pattern="^(today|7d|30d|3m|custom)$"),
    date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
    principal: Principal = Depends(staff), db: Session = Depends(get_db),
):
    """Collection, farmer and SMS trend per day for the dashboard: today, 7 days, 30 days, 3 months or a custom
    window of at most one year (always this cooperative's data)."""
    return coop_dashboard.trends(db, principal.cooperative.id, range, date_from, date_to)


# ---------------- activity ----------------

@router.get("/activity")
def list_activity(
    params: PageParams = Depends(page_params),
    include_security: bool = Query(False, description="Include sign-ins and other security events"),
    principal: Principal = Depends(_staff_with(Permission.AUDIT_READ)),
    db: Session = Depends(get_db),
):
    return audit.cooperative_activity(db, principal.cooperative.id, include_security, params)


# ---------------- SMS credits ----------------

@router.get("/sms-credits")
def sms_credits(principal: Principal = Depends(_staff_with(Permission.PAYMENT_READ)), db: Session = Depends(get_db)):
    return payments.credit_overview(db, principal.cooperative)


class _InfoResponse(BaseModel):
    response: str = Field(..., min_length=3, max_length=1000)


@router.post("/sms-credits/payments/{payment_id}/respond")
def respond_to_payment_question(
    payment_id: str, body: _InfoResponse, principal: Principal = Depends(_staff_with(Permission.SMS_CREDIT_PURCHASE)), db: Session = Depends(get_db),
):
    """Answer platform staff's request for information; the payment returns to the verification queue."""
    payment = own(db, principal, SMSCreditPayment, payment_id, "Payment")
    payment = payments.respond_information(db, principal, payment, body.response.strip())
    return payments.with_package_json(db, payment, principal.cooperative)


@router.post("/sms-credits/payments", status_code=status.HTTP_201_CREATED)
def submit_sms_payment(payload: SmsTopUpCreate, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    return payments.with_package_json(db, payments.submit(db, principal, payload), principal.cooperative)


# ---------------- cooler monitoring: readings, sensors, alerts ----------------

@router.get("/coolers/{cooler_id}/readings")
def list_cooler_readings(
    cooler_id: str,
    limit: int = Query(100, ge=1, le=500),
    principal: Principal = Depends(require_permission(Permission.COOLER_READ)),
    db: Session = Depends(get_db),
):
    """Most recent readings first (append-only history; suspicious ones included and flagged)."""
    cooler = own(db, principal.require_tenant(), Cooler, cooler_id, "Cooler")
    return cooler_readings.recent(db, cooler, limit)


@router.get("/sensors")
def list_sensors(principal: Principal = Depends(require_permission(Permission.COOLER_READ)), db: Session = Depends(get_db)):
    return sensors.list_for(db, principal.require_tenant().cooperative.id)


@router.post("/sensors", status_code=status.HTTP_201_CREATED)
def register_sensor(
    payload: SensorCreate, principal: Principal = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db)
):
    """Register a sensor (optionally binding it to a cooler). Needs a connection: server-authoritative."""
    return sensors.sensor_json(sensors.register(db, principal, payload))


@router.patch("/sensors/{sensor_id}")
def update_sensor(
    sensor_id: str, payload: SensorUpdate,
    principal: Principal = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db),
):
    """Rename, (re)bind to a cooler (`cooler_id`, null unbinds), set protocol/calibration, deactivate."""
    sensor = own(db, principal, SensorDevice, sensor_id, "Sensor")
    return sensors.sensor_json(sensors.update(db, principal, sensor, payload))


@router.get("/notifications")
def list_notifications(
    params: PageParams = Depends(page_params),
    notification_status: Optional[str] = Query(
        None, alias="status", pattern="^(PENDING|PENDING_PROVIDER|RESERVED|SENDING|SENT|FAILED|REFUNDED|SKIPPED)$",
    ),
    principal: Principal = Depends(staff),
    db: Session = Depends(get_db),
):
    """Cooler alert notifications and their SMS delivery state."""
    return notifications.list_page(db, principal.cooperative.id, notification_status, params)


@router.post("/notifications/{notification_id}/retry")
def retry_notification(notification_id: str, principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    notification = own(db, principal, Notification, notification_id, "Notification")
    return notifications.notification_json(notifications.retry(db, principal, notification))


@router.post("/coolers/alerts/check")
def check_cooler_alerts(principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    """Raise stale-reading alerts now and retry due SMS deliveries (also done on every device sync)."""
    return notifications.check_cooler_alerts(db, principal.cooperative.id, principal)


# ---------------- devices ----------------

@router.get("/devices")
def list_devices(principal: Principal = Depends(staff), db: Session = Depends(get_db)):
    """Devices registered to this cooperative, newest activity first."""
    return devices.list_for(db, principal.cooperative)


@router.patch("/devices/{device_id}")
def update_device(device_id: str, payload: DeviceUpdate, principal: Principal = Depends(admin_only), db: Session = Depends(get_db)):
    """Rename a device, or deactivate it (ends its offline sessions; it can't sync until reactivated)."""
    device = own(db, principal, Device, device_id, "Device")
    active = device.is_active if payload.is_active is None else payload.is_active
    return devices.device_json(devices.set_active(db, principal, device, active, payload.label), principal.cooperative.name)
