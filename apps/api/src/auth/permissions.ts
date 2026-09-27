import type { MembershipRole, PlatformRole } from '@prisma/client';

/**
 * Single source of truth for RBAC. Endpoints declare permissions, never roles;
 * roles are only bundles of permissions. The web app receives the resolved
 * permission list from GET /auth/me and must not keep its own copy of this map.
 */
export const PLATFORM_PERMISSIONS = [
  'platform:cooperatives:read',
  'platform:cooperatives:review',
  'platform:users:read',
  'platform:users:manage',
  'platform:payments:verify',
] as const;

export const TENANT_PERMISSIONS = [
  'cooperative:read',
  'cooperative:manage',
  'members:read',
  'members:manage',
  'farmers:read',
  'farmers:manage',
  'collections:read',
  'collections:create',
  'corrections:request',
  'corrections:decide',
  'reversals:request',
  'reversals:decide',
  'coolers:read',
  'coolers:manage',
  'pricing:read',
  'pricing:manage',
  'sms:read',
  'sms:purchase',
  'reports:read',
  'audit:read',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type Permission = PlatformPermission | TenantPermission;

export const isTenantPermission = (permission: Permission): permission is TenantPermission =>
  (TENANT_PERMISSIONS as readonly string[]).includes(permission);

const TENANT_READ: TenantPermission[] = [
  'cooperative:read', 'members:read', 'farmers:read', 'collections:read',
  'coolers:read', 'pricing:read', 'sms:read', 'reports:read', 'audit:read',
];

/** Global permissions for platform staff, plus what they may do inside any cooperative. */
const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, { platform: PlatformPermission[]; tenant: TenantPermission[] }> = {
  PLATFORM_SUPER_ADMIN: { platform: [...PLATFORM_PERMISSIONS], tenant: [...TENANT_PERMISSIONS] },
  PLATFORM_ADMIN: {
    platform: ['platform:cooperatives:read', 'platform:cooperatives:review', 'platform:users:read', 'platform:payments:verify'],
    tenant: TENANT_READ,
  },
  PLATFORM_SUPPORT: {
    platform: ['platform:cooperatives:read', 'platform:users:read'],
    tenant: TENANT_READ.filter((p) => p !== 'audit:read'),
  },
};

const MEMBERSHIP_ROLE_PERMISSIONS: Record<MembershipRole, TenantPermission[]> = {
  COOPERATIVE_MANAGER: [...TENANT_PERMISSIONS],
  ACCOUNTANT: [
    'cooperative:read', 'members:read', 'farmers:read', 'collections:read', 'coolers:read',
    'pricing:read', 'pricing:manage', 'sms:read', 'sms:purchase', 'reports:read', 'audit:read',
  ],
  COLLECTOR: [
    'cooperative:read', 'farmers:read', 'collections:read', 'collections:create',
    'corrections:request', 'reversals:request', 'coolers:read', 'pricing:read',
  ],
  // Farmers get no collection access until reads are scoped to their own records.
  FARMER: ['cooperative:read'],
};

/** Roles whose sessions must be stepped up to aal2 before touching the API. */
export const MFA_PLATFORM_ROLES: PlatformRole[] = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT'];
export const MFA_MEMBERSHIP_ROLES: MembershipRole[] = ['COOPERATIVE_MANAGER', 'ACCOUNTANT'];

export function platformPermissions(role: PlatformRole | null): PlatformPermission[] {
  return role ? PLATFORM_ROLE_PERMISSIONS[role].platform : [];
}

export function tenantPermissions(platformRole: PlatformRole | null, membershipRoles: MembershipRole[]): TenantPermission[] {
  const granted = new Set<TenantPermission>(platformRole ? PLATFORM_ROLE_PERMISSIONS[platformRole].tenant : []);
  for (const role of membershipRoles) MEMBERSHIP_ROLE_PERMISSIONS[role].forEach((p) => granted.add(p));
  return TENANT_PERMISSIONS.filter((p) => granted.has(p));
}
