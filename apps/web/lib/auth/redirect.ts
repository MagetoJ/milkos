/** Routes reachable without a session. Everything else is redirected to /login by proxy.ts. */
export const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/applications/status'];
export const PUBLIC_PREFIXES = ['/auth/callback', '/auth/confirm'];
/** Pages that manage the session itself; the app shell and MFA gate stay out of the way here. */
export const AUTH_FLOW_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/mfa'];

export const DEFAULT_AFTER_SIGN_IN = '/dashboard';

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Only same-origin relative paths are allowed as post-login targets (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = DEFAULT_AFTER_SIGN_IN): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
