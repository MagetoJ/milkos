import type { CooperativeStatus, MembershipRole, MembershipStatus, PlatformRole } from '@prisma/client';
import type { Permission } from './permissions';

export interface SupabaseClaims {
  sub: string;
  email?: string;
  phone?: string;
  role: string;
  aal?: 'aal1' | 'aal2';
  amr?: Array<{ method: string; timestamp: number }>;
  session_id?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export interface PrincipalMembership {
  id: string;
  cooperativeId: string;
  cooperativeName: string;
  cooperativeStatus: CooperativeStatus;
  role: MembershipRole;
  status: MembershipStatus;
}

/** The authenticated caller, attached to `request.user` by AuthGuard. */
export interface AuthPrincipal {
  /** Milkos User.id — use this for every createdBy/actorUserId column. */
  id: string;
  authUserId: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  platformRole: PlatformRole | null;
  defaultCooperativeId: string | null;
  aal: 'aal1' | 'aal2';
  signInMethods: string[];
  /** ACTIVE memberships only. */
  memberships: PrincipalMembership[];
}

/** The cooperative the current request acts on, attached to `request.tenant` by AccessGuard. */
export interface RequestTenant {
  cooperativeId: string;
  roles: MembershipRole[];
  /** True when access comes from a platform role rather than a membership. */
  viaPlatformRole: boolean;
}

export interface AuthenticatedRequest {
  user?: AuthPrincipal;
  tenant?: RequestTenant;
  permissions?: Set<Permission>;
  params?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  ip?: string;
  requestId?: string;
}
