// Single source of truth for sessions and role-based redirects.
// Every redirect in the app (login form, `/`, route guards, logout) goes through here.

export type UserRole = 'SUPER_ADMIN' | 'COOP_ADMIN' | 'MANAGER' | 'COLLECTOR' | 'FARMER';

export const TOKEN_KEY = 'milkflow_token';
export const LOGIN_PATH = '/login';

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<UserRole, string> = {
  SUPER_ADMIN: '/superadmin',
  COOP_ADMIN: '/cooperatives',
  MANAGER: '/cooperatives',
  COLLECTOR: '/collector',
  FARMER: '/collections',
};

/** Which roles may open each protected section. Edit this table to change access. */
export const ROUTE_ACCESS: Record<string, UserRole[]> = {
  '/superadmin': ['SUPER_ADMIN'],
  // A cooperative's own workspace: platform staff have no cooperative of their own, so they stay in /superadmin.
  '/cooperatives': ['COOP_ADMIN', 'MANAGER'],
  '/collections': ['COOP_ADMIN', 'MANAGER', 'COLLECTOR', 'FARMER'],
  // The collector's mobile app (cooperative staff may use it too, e.g. at a centre without a collector).
  '/collector': ['COLLECTOR', 'COOP_ADMIN', 'MANAGER'],
};

const ROLES = Object.keys(ROLE_HOME) as UserRole[];

export interface Session {
  token: string;
  userId: string;
  email?: string;
  role: UserRole;
  expiresAt?: number; // ms since epoch
}

/** Decode a JWT payload. JWT segments are base64url (RFC 7515), not plain base64. */
function decodePayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Read the stored session. Returns null (and clears the token) when it is missing,
 * malformed, expired or carries an unknown role. This does NOT verify the signature;
 * guards confirm with the backend via /api/v1/auth/me.
 */
export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const payload = decodePayload(token);
  const role = payload?.role as UserRole | undefined;
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp * 1000 : undefined;

  if (!payload || !role || !ROLES.includes(role) || (expiresAt !== undefined && expiresAt < Date.now())) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return { token, userId: String(payload.sub ?? ''), email: payload.email as string | undefined, role, expiresAt };
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

export function homeFor(role: UserRole): string {
  return ROLE_HOME[role] ?? LOGIN_PATH;
}

/** True when `role` may open `path` (matches the longest protected prefix). */
export function canAccess(role: UserRole, path: string): boolean {
  const section = Object.keys(ROUTE_ACCESS)
    .filter((prefix) => path === prefix || path.startsWith(prefix + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return section ? ROUTE_ACCESS[section].includes(role) : false;
}

/**
 * Where to send a user right after login: the `?next=` page they were bounced from,
 * but only if it is an internal path their role can open. Otherwise their role's home.
 */
export function postLoginRedirect(role: UserRole, next: string | null): string {
  const isSafeInternal = !!next && next.startsWith('/') && !next.startsWith('//');
  return isSafeInternal && canAccess(role, next!) ? next! : homeFor(role);
}

export function loginUrl(returnTo?: string): string {
  return returnTo ? `${LOGIN_PATH}?next=${encodeURIComponent(returnTo)}` : LOGIN_PATH;
}

export function logout() {
  clearSession();
  window.location.assign(LOGIN_PATH);
}