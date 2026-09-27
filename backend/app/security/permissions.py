"""Single source of truth for role-based access control.

Endpoints declare *permissions*, never roles; a role is only a bundle of
permissions. The web app receives the resolved list from ``GET /auth/me`` and
must not keep its own copy of this map.
"""

from app.db.enums import MembershipRole, PlatformRole

PLATFORM_PERMISSIONS: tuple[str, ...] = (
    "platform:cooperatives:read",
    "platform:cooperatives:review",
    "platform:users:read",
    "platform:users:manage",
    "platform:payments:verify",
)

TENANT_PERMISSIONS: tuple[str, ...] = (
    "cooperative:read",
    "cooperative:manage",
    "members:read",
    "members:manage",
    "farmers:read",
    "farmers:manage",
    "collections:read",
    "collections:create",
    "corrections:request",
    "corrections:decide",
    "reversals:request",
    "reversals:decide",
    "coolers:read",
    "coolers:manage",
    "pricing:read",
    "pricing:manage",
    "sms:read",
    "sms:purchase",
    "reports:read",
    "audit:read",
)

ALL_PERMISSIONS = frozenset(PLATFORM_PERMISSIONS + TENANT_PERMISSIONS)


def is_tenant_permission(permission: str) -> bool:
    return permission in TENANT_PERMISSIONS


_TENANT_READ = [
    "cooperative:read", "members:read", "farmers:read", "collections:read",
    "coolers:read", "pricing:read", "sms:read", "reports:read", "audit:read",
]

# Global permissions for platform staff, plus what they may do inside any cooperative.
_PLATFORM_ROLE_PERMISSIONS: dict[PlatformRole, dict[str, list[str]]] = {
    PlatformRole.PLATFORM_SUPER_ADMIN: {
        "platform": list(PLATFORM_PERMISSIONS),
        "tenant": list(TENANT_PERMISSIONS),
    },
    PlatformRole.PLATFORM_ADMIN: {
        "platform": [
            "platform:cooperatives:read", "platform:cooperatives:review",
            "platform:users:read", "platform:payments:verify",
        ],
        "tenant": _TENANT_READ,
    },
    PlatformRole.PLATFORM_SUPPORT: {
        "platform": ["platform:cooperatives:read", "platform:users:read"],
        "tenant": [p for p in _TENANT_READ if p != "audit:read"],
    },
}

_MEMBERSHIP_ROLE_PERMISSIONS: dict[MembershipRole, list[str]] = {
    MembershipRole.COOPERATIVE_MANAGER: list(TENANT_PERMISSIONS),
    MembershipRole.ACCOUNTANT: [
        "cooperative:read", "members:read", "farmers:read", "collections:read", "coolers:read",
        "pricing:read", "pricing:manage", "sms:read", "sms:purchase", "reports:read", "audit:read",
    ],
    MembershipRole.COLLECTOR: [
        "cooperative:read", "farmers:read", "collections:read", "collections:create",
        "corrections:request", "reversals:request", "coolers:read", "pricing:read",
    ],
    # Farmers get no collection access until reads are scoped to their own records.
    MembershipRole.FARMER: ["cooperative:read"],
}

# Roles whose sessions must be stepped up to aal2 (authenticator app) before using the API.
MFA_PLATFORM_ROLES = frozenset(PlatformRole)
MFA_MEMBERSHIP_ROLES = frozenset({MembershipRole.COOPERATIVE_MANAGER, MembershipRole.ACCOUNTANT})


def platform_permissions(role: PlatformRole | None) -> list[str]:
    return list(_PLATFORM_ROLE_PERMISSIONS[role]["platform"]) if role else []


def tenant_permissions(platform_role: PlatformRole | None, membership_roles: list[MembershipRole]) -> list[str]:
    """Union of what the platform role grants inside a cooperative and what the memberships grant.

    Returned in the canonical order of ``TENANT_PERMISSIONS`` so responses are stable.
    """
    granted: set[str] = set(_PLATFORM_ROLE_PERMISSIONS[platform_role]["tenant"]) if platform_role else set()
    for role in membership_roles:
        granted.update(_MEMBERSHIP_ROLE_PERMISSIONS[role])
    return [p for p in TENANT_PERMISSIONS if p in granted]