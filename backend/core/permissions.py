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

    PAYMENT_READ = "payment.read"
    PAYMENT_VERIFY = "payment.verify"
    PAYMENT_REJECT = "payment.reject"

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
        P.PAYMENT_READ, P.REPORT_READ, P.AUDIT_READ,
    }),
    # Day-to-day operations; cannot manage the team, collectors' accounts or decommission equipment.
    UserRole.MANAGER: frozenset({
        P.COOPERATIVE_READ, P.USER_READ,
        P.FARMER_READ, P.FARMER_CREATE, P.FARMER_UPDATE,
        P.COLLECTOR_READ, P.COLLECTOR_UPDATE,
        P.COOLER_READ, P.COOLER_UPDATE,
        P.COLLECTION_READ, P.COLLECTION_CREATE, P.COLLECTION_UPDATE,
        P.REPORT_READ,
    }),
    # Records milk; sees farmers and coolers of their cooperative and only their own collections.
    UserRole.COLLECTOR: frozenset({
        P.FARMER_READ, P.COOLER_READ, P.COLLECTION_READ, P.COLLECTION_CREATE,
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
