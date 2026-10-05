"""Cooperative workspace API: overview, collection centres, farmers, team, collectors, coolers, activity,
SMS credits, and cooler monitoring (readings, sensors, alert notifications) and the cooperative's devices.

Every endpoint works on the logged-in user's own cooperative (users.cooperative_id). The cooperative is
never taken from the URL; a body naming a different cooperative is refused. One cooperative therefore
cannot read or change another's data. Access is checked by core.access against the database.

  COOP_ADMIN  everything below
  MANAGER     read everything; create and edit centres, farmers, collector assignments and coolers;
              cannot change the team or decommission equipment
"""
import logging
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.access import Principal, ensure_same_cooperative, load_principal, require_permission
from core.pagination import PageParams, page_params, paginate
from core.permissions import Permission
from core.security import hash_password
from core.utils import iso, num, parse_uuid, reject_nulls
from db import get_db
from models.admin import AuditLog, Cooler, CoolerStatus, SMSCreditPackage, SMSCreditPayment
from models.centre import CollectionCentre
from models.cooperative import Cooperative
from models.farmer import Farmer
from models.notifications import Notification
from models.operations import Collector
from models.sensors import CoolerReading, SensorDevice
from models.sync import Device
from models.user import User
from routers.auth import conflict_error
from schemas.auth import UserRole
from schemas.cooperative_module import (
    CentreCreate,
    CentreUpdate,
    FarmerCreate,
    FarmerUpdate,
    TeamCreate,
    TeamUpdate,
)
from schemas.platform import CollectorCreate, CollectorUpdate, CoolerCreate, CoolerUpdate, SmsTopUpCreate
from schemas.sync import DeviceUpdate, SensorCreate, SensorUpdate
from services import (
    audit, centres, collectors, coop_dashboard, cooler_alerts, cooler_readings, coolers, cooperatives, farmers,
    notifications, payments, sensors,
)
from services.sync import devices
from services.users import account_conflict

router = APIRouter(prefix="/api/v1/cooperative", tags=["Cooperative"])
logger = logging.getLogger("milkflow.cooperative")

TEAM_ROLES = (UserRole.COOP_ADMIN, UserRole.MANAGER, UserRole.COLLECTOR)


# ---------------- who is calling, and for which cooperative ----------------

@dataclass
class Ctx:
    principal: Principal

    @property
    def user(self) -> User:
        return self.principal.user

    @property
    def cooperative(self) -> Cooperative:
        return self.principal.cooperative

    @property
    def role(self) -> str:
        return self.principal.role


def _context(allowed: set[UserRole]):
    allowed_values = {role.value for role in allowed}

    def dependency(principal: Principal = Depends(load_principal)) -> Ctx:
        # load_principal has already refused inactive accounts, accounts without a cooperative and
        # suspended cooperatives (all read from the database, not the token).
        if principal.role not in allowed_values or principal.cooperative is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
        return Ctx(principal)

    return dependency


staff = _context({UserRole.COOP_ADMIN, UserRole.MANAGER})
admin_only = _context({UserRole.COOP_ADMIN})


def _staff_with(permission: Permission):
    """Workspace staff (COOP_ADMIN / MANAGER) holding `permission`."""

    def dependency(ctx: Ctx = Depends(staff)) -> Ctx:
        ctx.principal.require(permission)
        return ctx

    return dependency


def _own(db: Session, model, raw_id: str, ctx: Ctx, what: str):
    # Someone else's row looks exactly like a missing one.
    return ensure_same_cooperative(ctx.principal, db.get(model, parse_uuid(raw_id, what)), what)


# ---------------- overview ----------------

@router.get("/overview")
def overview(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    coop = ctx.cooperative

    def count(model, *conditions) -> int:
        return db.query(func.count(model.id)).filter(model.cooperative_id == coop.id, *conditions).scalar() or 0

    team_counts = dict(
        db.query(User.role, func.count(User.id))
        .filter(User.cooperative_id == coop.id, User.is_active.is_(True), User.role.in_(TEAM_ROLES))
        .group_by(User.role)
        .all()
    )
    recent = (
        db.query(Farmer)
        .filter(Farmer.cooperative_id == coop.id)
        .order_by(Farmer.created_at.desc(), Farmer.farmer_number.desc())
        .limit(5)
        .all()
    )

    return {
        "role": ctx.role,
        "cooperative": {
            "name": coop.name,
            "code": coop.code,
            "county": coop.county,
            "location": coop.location,
            "status": coop.status,
            "sms_credit_balance": coop.sms_credit_balance or 0,
            "estimated_daily_liters": num(coop.estimated_daily_liters),
            "created_at": iso(coop.created_at),
        },
        "farmers": {
            "total": count(Farmer),
            "active": count(Farmer, Farmer.status == "ACTIVE"),
            "unassigned": count(Farmer, Farmer.status == "ACTIVE", Farmer.centre_id.is_(None)),
        },
        "centres": {
            "total": count(CollectionCentre),
            "active": count(CollectionCentre, CollectionCentre.status == "ACTIVE"),
            "with_cooler": count(CollectionCentre, CollectionCentre.status == "ACTIVE", CollectionCentre.has_cooler.is_(True)),
        },
        "coolers": {
            "total": count(Cooler, Cooler.status == CoolerStatus.ACTIVE),
            "operational": count(Cooler, Cooler.status == CoolerStatus.ACTIVE, Cooler.is_operational.is_(True)),
        },
        "team": {
            "admins": team_counts.get(UserRole.COOP_ADMIN, 0),
            "managers": team_counts.get(UserRole.MANAGER, 0),
            "collectors": team_counts.get(UserRole.COLLECTOR, 0),
        },
        "milk": cooperatives.milk_volumes(db, coop.id),
        "kpis": coop_dashboard.kpis(db, coop.id),
        "charts": coop_dashboard.charts(db, coop.id),
        "recent_farmers": [
            {
                "id": str(f.id),
                "farmer_number": f.farmer_number,
                "full_name": f.full_name,
                "phone": f.phone,
                "created_at": iso(f.created_at),
            }
            for f in recent
        ],
    }


# ---------------- collection centres ----------------

@router.get("/centres")
def list_centres(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    rows = (
        db.query(CollectionCentre)
        .filter(CollectionCentre.cooperative_id == ctx.cooperative.id)
        .order_by(CollectionCentre.name)
        .all()
    )
    return centres.serialize(db, rows)


@router.post("/centres", status_code=status.HTTP_201_CREATED)
def create_centre(payload: CentreCreate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    return centres.serialize(db, [centres.create(db, ctx.principal, payload)])[0]


@router.patch("/centres/{centre_id}")
def update_centre(centre_id: str, payload: CentreUpdate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    centre = _own(db, CollectionCentre, centre_id, ctx, "Collection centre")
    return centres.serialize(db, [centres.update(db, ctx.principal, centre, payload)])[0]


# ---------------- farmers ----------------

@router.get("/farmers")
def list_farmers(
    search: Optional[str] = Query(None, max_length=100),
    centre_id: Optional[str] = Query(None, description="A centre id, or 'none' for farmers without a centre"),
    farmer_status: Optional[str] = Query(None, alias="status", pattern="^(ACTIVE|INACTIVE)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    ctx: Ctx = Depends(staff),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Farmer, CollectionCentre.name)
        .outerjoin(CollectionCentre, Farmer.centre_id == CollectionCentre.id)
        .filter(Farmer.cooperative_id == ctx.cooperative.id)
    )

    if farmer_status:
        query = query.filter(Farmer.status == farmer_status)
    if centre_id == "none":
        query = query.filter(Farmer.centre_id.is_(None))
    elif centre_id:
        query = query.filter(Farmer.centre_id == parse_uuid(centre_id, "Collection centre"))
    query = farmers.search_filter(query, search)

    total = query.count()
    rows = (
        query.order_by(Farmer.last_name, Farmer.first_name, Farmer.farmer_number)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [farmers.farmer_json(farmer, centre_name) for farmer, centre_name in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/farmers", status_code=status.HTTP_201_CREATED)
def create_farmer(payload: FarmerCreate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    farmer, centre = farmers.create(db, ctx.principal, payload)
    return farmers.farmer_json(farmer, centre.name if centre else None)


@router.patch("/farmers/{farmer_id}")
def update_farmer(farmer_id: str, payload: FarmerUpdate, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    farmer = farmers.update(db, ctx.principal, _own(db, Farmer, farmer_id, ctx, "Farmer"), payload)
    centre = db.get(CollectionCentre, farmer.centre_id) if farmer.centre_id else None
    return farmers.farmer_json(farmer, centre.name if centre else None)


# ---------------- team ----------------

def _member_json(user: User, current: User) -> dict:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "role": user.role_value,
        "is_active": bool(user.is_active),
        "is_you": user.id == current.id,
        "created_at": iso(user.created_at),
    }


@router.get("/team")
def list_team(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    members = (
        db.query(User)
        .filter(User.cooperative_id == ctx.cooperative.id, User.role.in_(TEAM_ROLES))
        .order_by(User.full_name)
        .all()
    )
    order = {UserRole.COOP_ADMIN.value: 0, UserRole.MANAGER.value: 1, UserRole.COLLECTOR.value: 2}
    members.sort(key=lambda u: (order.get(u.role_value, 9), u.full_name.lower()))
    return [_member_json(u, ctx.user) for u in members]


@router.post("/team", status_code=status.HTTP_201_CREATED)
def create_team_member(payload: TeamCreate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    conflict = account_conflict(db, email=payload.email, phone=payload.phone)
    if conflict:
        raise conflict_error(*conflict)

    member = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone_number=payload.phone,
        role=UserRole(payload.role),
        cooperative_id=ctx.cooperative.id,
        is_active=True,
    )
    db.add(member)
    try:
        db.flush()
        if payload.role == UserRole.COLLECTOR.value:
            collectors.ensure_profile(db, member)
        audit.record(
            db, ctx.principal, "USER_CREATED", target=f"{member.full_name} <{member.email}> as {payload.role}",
            entity_type="user", entity_id=member.id, cooperative_id=ctx.cooperative.id,
            new_values={"email": member.email, "role": payload.role},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        conflict = account_conflict(db, email=payload.email, phone=payload.phone)
        raise conflict_error(*(conflict or (None, "An account with these details already exists.")))
    db.refresh(member)
    return _member_json(member, ctx.user)


@router.patch("/team/{member_id}")
def update_team_member(member_id: str, payload: TeamUpdate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    member = _own_member(db, member_id, ctx)
    data = payload.model_dump(exclude_unset=True)
    reject_nulls(data, "full_name", "phone", "role", "is_active", "password")

    conflict = account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
    if conflict:
        raise conflict_error(*conflict)

    old_role = member.role_value
    if "full_name" in data:
        member.full_name = data["full_name"]
    if "phone" in data:
        member.phone_number = data["phone"]
    if "role" in data:
        member.role = UserRole(data["role"])
    if "is_active" in data:
        member.is_active = data["is_active"]
    if "password" in data:
        member.password_hash = hash_password(data["password"])

    # Keep the collector profile in step with the account.
    profile = db.query(Collector).filter(Collector.user_id == member.id).first()
    if member.role_value == UserRole.COLLECTOR.value:
        profile = collectors.ensure_profile(db, member)
        profile.status = "ACTIVE" if member.is_active else "INACTIVE"
    elif profile is not None:
        profile.status = "INACTIVE"

    changes = {k: v for k, v in data.items() if k != "password"}
    action = (
        "USER_ROLE_CHANGED" if member.role_value != old_role
        else ("USER_ACTIVATED" if member.is_active else "USER_DISABLED") if set(changes) == {"is_active"}
        else "USER_PASSWORD_RESET" if set(data) == {"password"}
        else "USER_UPDATED"
    )
    audit.record(
        db, ctx.principal, action, target=f"{member.full_name} <{member.email}>",
        entity_type="user", entity_id=member.id, cooperative_id=ctx.cooperative.id,
        old_values={"role": old_role} if member.role_value != old_role else None, new_values=changes or None,
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        conflict = account_conflict(db, email=None, phone=data.get("phone"), exclude_id=member.id)
        raise conflict_error(*(conflict or (None, "These details clash with another account.")))
    db.refresh(member)
    return _member_json(member, ctx.user)


def _own_member(db: Session, member_id: str, ctx: Ctx) -> User:
    member = db.get(User, parse_uuid(member_id, "Team member"))
    if member is None or member.cooperative_id != ctx.cooperative.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    if member.role_value == UserRole.COOP_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The cooperative admin's account can't be changed here.")
    if member.role_value not in {UserRole.MANAGER.value, UserRole.COLLECTOR.value}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    return member


# ---------------- collectors ----------------

def _collector_rows(db: Session, cooperative_id: UUID, collector_id: Optional[UUID] = None):
    query = (
        db.query(Collector, User, CollectionCentre.name, Cooler.name)
        .join(User, User.id == Collector.user_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Collector.centre_id)
        .outerjoin(Cooler, Cooler.id == Collector.cooler_id)
        .filter(Collector.cooperative_id == cooperative_id)
    )
    if collector_id:
        query = query.filter(Collector.id == collector_id)
    rows = query.order_by(User.full_name).all()
    stats = collectors.stats_for(db, [r[0].id for r in rows])
    return [
        collectors.collector_json(c, u, centre_name=centre, cooler_name=cooler, stats=stats.get(c.id))
        for c, u, centre, cooler in rows
    ]


@router.get("/collectors")
def list_collectors(ctx: Ctx = Depends(_staff_with(Permission.COLLECTOR_READ)), db: Session = Depends(get_db)):
    return _collector_rows(db, ctx.cooperative.id)


@router.post("/collectors", status_code=status.HTTP_201_CREATED)
def create_collector(
    payload: CollectorCreate, ctx: Ctx = Depends(_staff_with(Permission.COLLECTOR_CREATE)), db: Session = Depends(get_db)
):
    profile = collectors.create(db, ctx.principal, payload)
    return _collector_rows(db, ctx.cooperative.id, profile.id)[0]


@router.patch("/collectors/{collector_id}")
def update_collector(
    collector_id: str, payload: CollectorUpdate,
    ctx: Ctx = Depends(_staff_with(Permission.COLLECTOR_UPDATE)), db: Session = Depends(get_db),
):
    profile = _own(db, Collector, collector_id, ctx, "Collector")
    if "status" in payload.model_fields_set:
        ctx.principal.require(Permission.COLLECTOR_DISABLE)
    profile = collectors.update(db, ctx.principal, profile, payload)
    return _collector_rows(db, ctx.cooperative.id, profile.id)[0]


# ---------------- coolers ----------------

def _cooler_rows(db: Session, cooperative_id: UUID, cooler_id: Optional[UUID] = None) -> list[dict]:
    query = (
        db.query(Cooler, CollectionCentre.name)
        .outerjoin(CollectionCentre, CollectionCentre.id == Cooler.centre_id)
        .filter(Cooler.cooperative_id == cooperative_id)
    )
    if cooler_id:
        query = query.filter(Cooler.id == cooler_id)
    rows = query.order_by(Cooler.status, Cooler.code).all()
    ids = [c.id for c, _ in rows]
    today = coolers.litres_today(db, ids)
    managers = centres.manager_names(db, {c.manager_user_id for c, _ in rows})
    bound = sensors.for_coolers(db, ids)
    context = coolers.context_for(db, [c for c, _ in rows], bound)
    return [
        coolers.cooler_json(
            c, centre_name=centre, litres_today=today.get(c.id, 0.0), manager_name=managers.get(c.manager_user_id),
            sensors=bound.get(c.id), context=context.get(c.id),
        )
        for c, centre in rows
    ]


@router.get("/coolers")
def list_coolers(principal: Principal = Depends(require_permission(Permission.COOLER_READ)), db: Session = Depends(get_db)):
    # Collectors may read their cooperative's coolers too (to choose one when recording milk).
    if principal.cooperative is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
    return _cooler_rows(db, principal.cooperative.id)


@router.post("/coolers", status_code=status.HTTP_201_CREATED)
def create_cooler(
    payload: CoolerCreate, ctx: Ctx = Depends(_staff_with(Permission.COOLER_CREATE)), db: Session = Depends(get_db)
):
    cooler = coolers.create(db, ctx.principal, payload)
    return _cooler_rows(db, ctx.cooperative.id, cooler.id)[0]


@router.patch("/coolers/{cooler_id}")
def update_cooler(
    cooler_id: str, payload: CoolerUpdate,
    ctx: Ctx = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db),
):
    cooler = _own(db, Cooler, cooler_id, ctx, "Cooler")
    if "status" in payload.model_fields_set:
        ctx.principal.require(Permission.COOLER_DISABLE)
    cooler = coolers.update(db, ctx.principal, cooler, payload)
    return _cooler_rows(db, ctx.cooperative.id, cooler.id)[0]


# ---------------- activity ----------------

@router.get("/activity")
def list_activity(
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(_staff_with(Permission.AUDIT_READ)),
    db: Session = Depends(get_db),
):
    query = (
        db.query(AuditLog)
        .filter(AuditLog.cooperative_id == ctx.cooperative.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id)
    )
    return paginate(query, params, audit.entry_json)


# ---------------- SMS credits ----------------

@router.get("/sms-credits")
def sms_credits(ctx: Ctx = Depends(_staff_with(Permission.PAYMENT_READ)), db: Session = Depends(get_db)):
    packages = db.query(SMSCreditPackage).filter(SMSCreditPackage.is_active.is_(True)).order_by(SMSCreditPackage.credits_amount).all()
    history = (
        db.query(SMSCreditPayment, SMSCreditPackage)
        .outerjoin(SMSCreditPackage, SMSCreditPackage.id == SMSCreditPayment.package_id)
        .filter(SMSCreditPayment.cooperative_id == ctx.cooperative.id)
        .order_by(SMSCreditPayment.submitted_at.desc())
        .limit(50)
        .all()
    )
    from services import sms_credits

    return {
        "balance": sms_credits.available(db, ctx.cooperative.id),
        "packages": [
            {"id": str(p.id), "name": p.name, "credits_amount": p.credits_amount, "price_kes": num(p.price_kes)}
            for p in packages
        ],
        "payments": [payments.payment_json(p, ctx.cooperative, pkg) for p, pkg in history],
    }


@router.post("/sms-credits/payments", status_code=status.HTTP_201_CREATED)
def submit_sms_payment(payload: SmsTopUpCreate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    payment = payments.submit(db, ctx.principal, payload)
    package = db.get(SMSCreditPackage, payment.package_id) if payment.package_id else None
    return payments.payment_json(payment, ctx.cooperative, package)


# ---------------- cooler monitoring: readings, sensors, alerts ----------------

@router.get("/coolers/{cooler_id}/readings")
def list_cooler_readings(
    cooler_id: str,
    limit: int = Query(100, ge=1, le=500),
    principal: Principal = Depends(require_permission(Permission.COOLER_READ)),
    db: Session = Depends(get_db),
):
    """Most recent readings first (append-only history; suspicious ones included and flagged)."""
    if principal.cooperative is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
    cooler = ensure_same_cooperative(principal, db.get(Cooler, parse_uuid(cooler_id, "Cooler")), "Cooler")
    rows = (
        db.query(CoolerReading).filter(CoolerReading.cooler_id == cooler.id)
        .order_by(CoolerReading.measured_at.desc(), CoolerReading.id).limit(limit).all()
    )
    return [cooler_readings.reading_json(r) for r in rows]


@router.get("/sensors")
def list_sensors(principal: Principal = Depends(require_permission(Permission.COOLER_READ)), db: Session = Depends(get_db)):
    if principal.cooperative is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")
    rows = (
        db.query(SensorDevice, Cooler.name)
        .outerjoin(Cooler, Cooler.id == SensorDevice.cooler_id)
        .filter(SensorDevice.cooperative_id == principal.cooperative.id)
        .order_by(SensorDevice.name)
        .all()
    )
    return [sensors.sensor_json(s, cooler_name) for s, cooler_name in rows]


@router.post("/sensors", status_code=status.HTTP_201_CREATED)
def register_sensor(
    payload: SensorCreate, ctx: Ctx = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db)
):
    """Register a sensor (optionally binding it to a cooler). Needs a connection: server-authoritative."""
    return sensors.sensor_json(sensors.register(db, ctx.principal, payload))


@router.patch("/sensors/{sensor_id}")
def update_sensor(
    sensor_id: str, payload: SensorUpdate,
    ctx: Ctx = Depends(_staff_with(Permission.COOLER_UPDATE)), db: Session = Depends(get_db),
):
    """Rename, (re)bind to a cooler (`cooler_id`, null unbinds), set protocol/calibration, deactivate."""
    sensor = _own(db, SensorDevice, sensor_id, ctx, "Sensor")
    return sensors.sensor_json(sensors.update(db, ctx.principal, sensor, payload))


@router.get("/notifications")
def list_notifications(
    params: PageParams = Depends(page_params),
    notification_status: Optional[str] = Query(
        None, alias="status", pattern="^(PENDING|PENDING_PROVIDER|RESERVED|SENDING|SENT|FAILED|REFUNDED|SKIPPED)$",
    ),
    ctx: Ctx = Depends(staff),
    db: Session = Depends(get_db),
):
    """Cooler alert notifications and their SMS delivery state."""
    query = db.query(Notification).filter(Notification.cooperative_id == ctx.cooperative.id)
    if notification_status:
        query = query.filter(Notification.status == notification_status)
    query = query.order_by(Notification.created_at.desc(), Notification.id)
    return paginate(query, params, notifications.notification_json)


@router.post("/notifications/{notification_id}/retry")
def retry_notification(notification_id: str, ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    notification = _own(db, Notification, notification_id, ctx, "Notification")
    return notifications.notification_json(notifications.retry(db, ctx.principal, notification))


@router.post("/coolers/alerts/check")
def check_cooler_alerts(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    """Raise stale-reading alerts now and retry due SMS deliveries (also done on every device sync)."""
    created = cooler_alerts.evaluate_staleness(db, ctx.cooperative.id)
    db.commit()
    sent = notifications.dispatch(db, [n.id for n in created], ctx.principal)
    retried = notifications.dispatch_due(db, ctx.cooperative.id, ctx.principal)
    return {"created": len(created), "delivered": [notifications.notification_json(n) for n in sent + retried]}


# ---------------- devices ----------------

@router.get("/devices")
def list_devices(ctx: Ctx = Depends(staff), db: Session = Depends(get_db)):
    """Devices registered to this cooperative, newest activity first."""
    rows = (
        db.query(Device).filter(Device.cooperative_id == ctx.cooperative.id)
        .order_by(Device.last_seen_at.desc().nullslast(), Device.created_at.desc()).all()
    )
    return [devices.device_json(d, ctx.cooperative.name) for d in rows]


@router.patch("/devices/{device_id}")
def update_device(device_id: str, payload: DeviceUpdate, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    """Rename a device, or deactivate it (ends its offline sessions; it can't sync until reactivated)."""
    device = _own(db, Device, device_id, ctx, "Device")
    active = device.is_active if payload.is_active is None else payload.is_active
    return devices.device_json(devices.set_active(db, ctx.principal, device, active, payload.label), ctx.cooperative.name)
