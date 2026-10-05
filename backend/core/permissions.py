"""Role -> permission table. The single place that says what each role may do.

Permissions answer "may this role perform this kind of action at all". *Which* rows the action may
touch (own cooperative, own collections, own farmer record) is enforced separately by core.access.
"""
from enum import Enum

from schemas.auth import UserRole


class Permission(str, Enum):
    COOPERATIVE_READ = "cooperative.read"
    COOPERATIVE_CREATE = "cooperative.create"
    COOPERATIVE_UPDATE = "cooperative.update"
    COOPERATIVE_SUSPEND = "cooperative.suspend"

    USER_READ = "user.read"
    USER_CREATE = "user.create"
    USER_UPDATE = "user.update"
    USER_DISABLE = "user.disable"

    FARMER_READ = "farmer.read"
    FARMER_CREATE = "farmer.create"
    FARMER_UPDATE = "farmer.update"
    FARMER_DISABLE = "farmer.disable"

    COLLECTOR_READ = "collector.read"
    COLLECTOR_CREATE = "collector.create"
    COLLECTOR_UPDATE = "collector.update"
    COLLECTOR_DISABLE = "collector.disable"

    COOLER_READ = "cooler.read"
    COOLER_CREATE = "cooler.create"
    COOLER_UPDATE = "cooler.update"
    COOLER_DISABLE = "cooler.disable"

    COLLECTION_READ = "collection.read"
    COLLECTION_CREATE = "collection.create"
    COLLECTION_UPDATE = "collection.update"
    CORRECTION_REQUEST = "collection.correction.request"
    CORRECTION_APPROVE = "collection.correction.approve"
    REVERSAL_REQUEST = "collection.reversal.request"
    REVERSAL_APPROVE = "collection.reversal.approve"

    PAYMENT_READ = "payment.read"
    PAYMENT_VERIFY = "payment.verify"
    PAYMENT_REJECT = "payment.reject"

    SMS_CREDIT_READ = "sms_credit.read"
    SMS_CREDIT_PURCHASE = "sms_credit.purchase"
    SMS_CREDIT_ADJUST = "sms_credit.adjust"

    PRICING_READ = "pricing.read"
    PRICING_MANAGE = "pricing.manage"
    FARMER_PAYMENT_READ = "farmer_payment.read"
    FARMER_PAYMENT_MANAGE = "farmer_payment.manage"

    REPORT_READ = "report.read"
    AUDIT_READ = "audit.read"
    SETTINGS_MANAGE = "settings.manage"


P = Permission

ROLE_PERMISSIONS: dict[UserRole, frozenset[Permission]] = {
    UserRole.SUPER_ADMIN: frozenset(Permission),
    # Everything inside their own cooperative except platform-level actions.
    UserRole.COOP_ADMIN: frozenset({
        P.COOPERATIVE_READ,
        P.USER_READ, P.USER_CREATE, P.USER_UPDATE, P.USER_DISABLE,
        P.FARMER_READ, P.FARMER_CREATE, P.FARMER_UPDATE, P.FARMER_DISABLE,
        P.COLLECTOR_READ, P.COLLECTOR_CREATE, P.COLLECTOR_UPDATE, P.COLLECTOR_DISABLE,
        P.COOLER_READ, P.COOLER_CREATE, P.COOLER_UPDATE, P.COOLER_DISABLE,
        P.COLLECTION_READ, P.COLLECTION_CREATE, P.COLLECTION_UPDATE,
        P.CORRECTION_REQUEST, P.CORRECTION_APPROVE, P.REVERSAL_REQUEST, P.REVERSAL_APPROVE,
        P.PAYMENT_READ, P.REPORT_READ, P.AUDIT_READ,
        P.SMS_CREDIT_READ, P.SMS_CREDIT_PURCHASE,
        P.PRICING_READ, P.PRICING_MANAGE, P.FARMER_PAYMENT_READ, P.FARMER_PAYMENT_MANAGE,
    }),
    # Day-to-day operations; cannot manage the team, collectors' accounts or decommission equipment.
    UserRole.MANAGER: frozenset({
        P.COOPERATIVE_READ, P.USER_READ,
        P.FARMER_READ, P.FARMER_CREATE, P.FARMER_UPDATE,
        P.COLLECTOR_READ, P.COLLECTOR_UPDATE,
        P.COOLER_READ, P.COOLER_UPDATE,
        P.COLLECTION_READ, P.COLLECTION_CREATE, P.COLLECTION_UPDATE,
        # Managers may request and review corrections, but only an admin may approve a reversal.
        P.CORRECTION_REQUEST, P.CORRECTION_APPROVE, P.REVERSAL_REQUEST,
        P.REPORT_READ, P.SMS_CREDIT_READ, P.PRICING_READ, P.FARMER_PAYMENT_READ,
    }),
    # Records milk; sees farmers and coolers of their cooperative and only their own collections.
    UserRole.COLLECTOR: frozenset({
        P.FARMER_READ, P.COOLER_READ, P.COLLECTION_READ, P.COLLECTION_CREATE,
        # ...and may ask for a correction or reversal of their own collections (never approve one).
        P.CORRECTION_REQUEST, P.REVERSAL_REQUEST,
    }),
    # Sees only their own deliveries.
    UserRole.FARMER: frozenset({P.COLLECTION_READ}),
}


def permissions_for(role: UserRole | str) -> frozenset[Permission]:
    try:
        return ROLE_PERMISSIONS[UserRole(role)]
    except (KeyError, ValueError):
        return frozenset()


def has_permission(role: UserRole | str, permission: Permission | str) -> bool:
    try:
        return Permission(permission) in permissions_for(role)
    except ValueError:
        return False
