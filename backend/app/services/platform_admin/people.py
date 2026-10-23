"""Every sign-in account, farmer and collector on the platform: lists and details."""
from typing import Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.permissions import permission_names
from app.core.utils import like, parse_uuid, phone_digits
from app.domain.schemas.auth import UserRole
from app.infrastructure.db.models.admin import AuditLog, Cooler
from app.infrastructure.db.models.centre import CollectionCentre
from app.infrastructure.db.models.cooperative import Cooperative
from app.infrastructure.db.models.farmer import Farmer
from app.infrastructure.db.models.operations import Collector, MilkCollection
from app.infrastructure.db.models.user import User
from app.infrastructure.db.pagination import PageParams, apply_sort, fetch_page, page_result, paginate
from app.services import accounts, audit, collections, collectors, farmers, users
from app.services.platform_admin import overview
from app.services.principal import Principal, get_or_404

# ---------------- accounts ----------------

USER_SORTS = {
    "full_name": User.full_name, "email": User.email, "role": User.role,
    "created_at": User.created_at, "last_login_at": User.last_login_at,
}


def get_user(db: Session, user_id: str) -> User:
    return get_or_404(db, User, user_id, "User")


def user_json(db: Session, user: User, sms=None) -> dict:
    coop = db.get(Cooperative, user.cooperative_id) if user.cooperative_id else None
    data = users.user_json(user, coop, db)
    if sms is not None:
        # Whether the provider accepted the activation SMS. Never "delivered" unless a delivery report said so.
        data["activation_sms"] = accounts.sms_outcome(sms)
    return data


def users_page(db: Session, *, search: Optional[str], role: Optional[UserRole], cooperative_id: Optional[str],
               is_active: Optional[bool], account_status: Optional[str], params: PageParams) -> dict:
    """`cooperative_id` is an id, or 'none' for platform accounts."""
    query = db.query(User, Cooperative).outerjoin(Cooperative, Cooperative.id == User.cooperative_id)
    if role:
        query = query.filter(User.role == role)
    if cooperative_id == "none":
        query = query.filter(User.cooperative_id.is_(None))
    elif cooperative_id:
        query = query.filter(User.cooperative_id == parse_uuid(cooperative_id, "Cooperative"))
    if is_active is not None:
        query = query.filter(User.is_active.is_(is_active))
    if account_status:
        query = query.filter(User.account_status == account_status)
    query = users.search_filter(query, search)
    query = apply_sort(query, params.sort, USER_SORTS, [User.full_name, User.id])
    return paginate(query, params, lambda row: users.user_json(row[0], row[1], db))


def user_detail(db: Session, user: User) -> dict:
    history = (
        db.query(AuditLog)
        .filter(or_(
            (AuditLog.entity_type == "user") & (AuditLog.entity_id == str(user.id)),
            AuditLog.admin_id == user.id,
        ))
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        **user_json(db, user),
        "permissions": permission_names(user.role_value),
        "activity": [audit.entry_json(e) for e in history],
    }


# ---------------- farmers ----------------

FARMER_SORTS = {
    "name": Farmer.last_name, "farmer_number": Farmer.farmer_number, "created_at": Farmer.created_at,
    "cooperative": Cooperative.name, "status": Farmer.status,
}
_NO_STATS = {"total_litres": 0.0, "collections": 0, "last_collection": None}


def get_farmer(db: Session, farmer_id: str) -> Farmer:
    return get_or_404(db, Farmer, farmer_id, "Farmer")


def farmer_json(db: Session, farmer: Farmer) -> dict:
    centre = db.get(CollectionCentre, farmer.centre_id) if farmer.centre_id else None
    data = farmers.farmer_json(farmer, centre.name if centre else None, db.get(Cooperative, farmer.cooperative_id))
    data["stats"] = farmers.collection_stats(db, [farmer.id]).get(farmer.id) or dict(_NO_STATS)
    return data


def farmers_page(db: Session, *, search: Optional[str], cooperative_id: Optional[UUID], centre_id: Optional[UUID],
                 status: Optional[str], params: PageParams) -> dict:
    query = (
        db.query(Farmer, CollectionCentre.name, Cooperative)
        .join(Cooperative, Cooperative.id == Farmer.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Farmer.centre_id)
    )
    if cooperative_id:
        query = query.filter(Farmer.cooperative_id == cooperative_id)
    if centre_id:
        query = query.filter(Farmer.centre_id == centre_id)
    if status:
        query = query.filter(Farmer.status == status)
    query = farmers.search_filter(query, search)
    query = apply_sort(query, params.sort, FARMER_SORTS, [Farmer.last_name, Farmer.first_name, Farmer.id])
    rows, total = fetch_page(query, params)
    stats = farmers.collection_stats(db, [f.id for f, _, _ in rows])
    items = [
        {**farmers.farmer_json(f, centre_name, coop), "stats": stats.get(f.id, _NO_STATS)}
        for f, centre_name, coop in rows
    ]
    return page_result(items, total, params)


def farmer_detail(db: Session, admin: Principal, farmer: Farmer) -> dict:
    recent = (
        collections.scope(collections.base_query(db), admin)
        .filter(MilkCollection.farmer_id == farmer.id)
        .order_by(MilkCollection.collection_date.desc(), MilkCollection.collection_time.desc())
        .limit(10)
        .all()
    )
    return {
        **farmer_json(db, farmer),
        "recent_collections": [collections.collection_json(row) for row in recent],
        "activity": overview.entity_history(db, "farmer", farmer.id, limit=20),
        # Farmer milk payouts are not tracked by the platform yet; payout details are on the profile.
        "payments_supported": False,
    }


# ---------------- collectors ----------------

COLLECTOR_SORTS = {
    "name": User.full_name, "collector_number": Collector.collector_number,
    "created_at": Collector.created_at, "cooperative": Cooperative.name, "status": Collector.status,
}


def _collector_query(db: Session):
    return (
        db.query(Collector, User, Cooperative, CollectionCentre.name, Cooler.name)
        .join(User, User.id == Collector.user_id)
        .join(Cooperative, Cooperative.id == Collector.cooperative_id)
        .outerjoin(CollectionCentre, CollectionCentre.id == Collector.centre_id)
        .outerjoin(Cooler, Cooler.id == Collector.cooler_id)
    )


def _collector_rows(db: Session, rows) -> list[dict]:
    stats = collectors.stats_for(db, [row[0].id for row in rows])
    return [
        collectors.collector_json(c, u, cooperative=coop, centre_name=centre, cooler_name=cooler, stats=stats.get(c.id))
        for c, u, coop, centre, cooler in rows
    ]


def get_collector(db: Session, collector_id: str) -> Collector:
    return get_or_404(db, Collector, collector_id, "Collector")


def collector_json(db: Session, profile: Collector) -> dict:
    return _collector_rows(db, [_collector_query(db).filter(Collector.id == profile.id).one()])[0]


def collectors_page(db: Session, *, search: Optional[str], cooperative_id: Optional[UUID], cooler_id: Optional[UUID],
                    status: Optional[str], params: PageParams) -> dict:
    query = _collector_query(db)
    if cooperative_id:
        query = query.filter(Collector.cooperative_id == cooperative_id)
    if cooler_id:
        query = query.filter(Collector.cooler_id == cooler_id)
    if status:
        query = query.filter(Collector.status == status)
    for term in (search or "").split():
        clauses = [
            User.full_name.ilike(like(term), escape="\\"), User.email.ilike(like(term), escape="\\"),
            Collector.collector_number.ilike(like(term), escape="\\"), Collector.assigned_area.ilike(like(term), escape="\\"),
        ]
        digits = phone_digits(term)
        if digits:
            clauses.append(User.phone_number.like(f"%{digits}%"))
        query = query.filter(or_(*clauses))
    query = apply_sort(query, params.sort, COLLECTOR_SORTS, [User.full_name, Collector.id])
    rows, total = fetch_page(query, params)
    return page_result(_collector_rows(db, rows), total, params)


# ---------------- invitations (each texts an activation link and reports whether it went) ----------------

def create_user(db: Session, admin: Principal, payload) -> dict:
    """An account in PENDING_ACTIVATION, texted a one-time activation link. No password is set here."""
    user, pending = users.create(db, admin, payload)
    sms = accounts.dispatch(db, pending, ip=admin.ip_address, ua=admin.user_agent)
    db.refresh(user)
    return user_json(db, user, sms)


def resend_activation(db: Session, admin: Principal, user: User) -> dict:
    sms = accounts.dispatch(db, accounts.resend_activation(db, admin, user))
    db.refresh(user)
    return user_json(db, user, sms)


def create_collector(db: Session, admin: Principal, payload) -> dict:
    profile, pending = collectors.create(db, admin, payload)
    sms = accounts.dispatch(db, pending, ip=admin.ip_address, ua=admin.user_agent)
    db.refresh(profile)
    return {**collector_json(db, profile), "activation_sms": accounts.sms_outcome(sms)}
