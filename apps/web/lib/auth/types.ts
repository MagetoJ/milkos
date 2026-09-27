// Mirrors GET /api/v1/auth/me. Permissions are resolved by the API; the web app never maps roles itself.

export type PlatformRole = 'PLATFORM_SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';
export type MembershipRole = 'COOPERATIVE_MANAGER' | 'ACCOUNTANT' | 'COLLECTOR' | 'FARMER';
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export type Permission =
  | 'platform:cooperatives:read' | 'platform:cooperatives:review'
  | 'platform:users:read' | 'platform:users:manage' | 'platform:payments:verify'
  | 'cooperative:read' | 'cooperative:manage' | 'members:read' | 'members:manage'
  | 'farmers:read' | 'farmers:manage' | 'collections:read' | 'collections:create'
  | 'corrections:request' | 'corrections:decide' | 'reversals:request' | 'reversals:decide'
  | 'coolers:read' | 'coolers:manage' | 'pricing:read' | 'pricing:manage'
  | 'sms:read' | 'sms:purchase' | 'reports:read' | 'audit:read';

export interface MeCooperative {
  id: string;
  name: string;
  status: string;
  roles: MembershipRole[];
  permissions: Permission[];
}

export interface Me {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
    platformRole: PlatformRole | null;
    defaultCooperativeId: string | null;
  };
  session: {
    aal: 'aal1' | 'aal2';
    signInMethods: string[];
    mfaRequired: boolean;
    mfaSatisfied: boolean;
  };
  platformPermissions: Permission[];
  platformTenantPermissions: Permission[];
  cooperatives: MeCooperative[];
}

export const ROLE_LABELS: Record<PlatformRole | MembershipRole, string> = {
  PLATFORM_SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Platform Admin',
  PLATFORM_SUPPORT: 'Platform Support',
  COOPERATIVE_MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant',
  COLLECTOR: 'Collector',
  FARMER: 'Farmer',
};
