// Starting a workspace online or offline, and keeping the access token alive with the device session.
//
//   server reachable                -> confirm the account with the server (as before); make sure this
//                                      device holds an offline session for the user
//   server unreachable + valid      -> offline mode, as that user, until the session expires
//   offline session
//   server unreachable + none       -> "can't reach the server" (nobody gets in without having signed in online)
import { CHANGE_PASSWORD_PATH, clearSession, getSession, saveToken, TOKEN_KEY, type UserRole } from '@/lib/auth';
import { reportRequest, probe, startConnectivity } from './connectivity';
import { closeUserDb, deleteUserDb, openUserDb } from './db';
import { devicePlatform, getDeviceId, APP_VERSION } from './device';
import {
  checkOfflineSession,
  forgetOfflineSession,
  getActiveSession,
  saveOfflineSession,
  touchSessionClock,
  unsyncedCount,
  type OfflineSessionResponse,
} from './session';
import type { OfflineSessionRecord } from './types';

export interface MeResponse {
  user_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  cooperative_id: string | null;
  permissions: string[];
  account_status?: string;
  must_change_password?: boolean;
  phone_verified?: boolean;
  mfa_enabled?: boolean;
}

export type Boot =
  | { mode: 'online'; me: MeResponse; offline: OfflineSessionRecord | null }
  | { mode: 'offline'; session: OfflineSessionRecord }
  | { mode: 'login' }
  | { mode: 'wrong-role'; role: UserRole }
  | { mode: 'blocked'; message: string }
  | { mode: 'unreachable'; reason?: 'expired' | 'clock' | 'missing' };

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

function bearer(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Register this device for the signed-in user and store their offline session. Best effort. */
export async function provisionDevice(token?: string | null): Promise<OfflineSessionRecord | null> {
  try {
    const res = await fetch('/api/v1/devices/register', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...bearer(token ?? getSession()?.token) },
      body: JSON.stringify({ device_identifier: await getDeviceId(), platform: devicePlatform(), app_version: APP_VERSION }),
    });
    reportRequest(true);
    if (!res.ok) return null;
    const body = await readJson(res);
    return saveOfflineSession(body.offline_session as OfflineSessionResponse);
  } catch {
    reportRequest(false);
    return null;
  }
}

let refreshing: Promise<'ok' | 'invalid' | 'unreachable'> | null = null;

/**
 * Get a new access token from the device session (the server re-checks the account, cooperative and
 * device). 'invalid' means the offline session is over: the user must sign in again.
 */
export function refreshWithDeviceSession(): Promise<'ok' | 'invalid' | 'unreachable'> {
  refreshing ??= (async () => {
    const session = await getActiveSession();
    if (!session) return 'invalid' as const;
    try {
      const res = await fetch('/api/v1/devices/session/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_identifier: session.deviceId, session_token: session.token }),
      });
      reportRequest(true);
      if (res.status === 401 || res.status === 403) {
        await forgetOfflineSession(session.userId);
        return 'invalid' as const;
      }
      if (!res.ok) return 'unreachable' as const;
      const body = await readJson(res);
      saveToken(String(body.access_token));
      await saveOfflineSession(body.offline_session as OfflineSessionResponse);
      return 'ok' as const;
    } catch {
      reportRequest(false);
      return 'unreachable' as const;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function fetchMe(token: string | null): Promise<{ status: number; me?: MeResponse; detail?: string }> {
  const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store', headers: bearer(token) });
  reportRequest(true);
  if (!res.ok) {
    const body = await readJson(res);
    return { status: res.status, detail: typeof body.detail === 'string' ? body.detail : undefined };
  }
  return { status: 200, me: (await res.json()) as MeResponse };
}

/** Decide how a protected workspace starts. Never lets anyone in offline without an offline session. */
export async function bootSession(allowed: UserRole[]): Promise<Boot> {
  startConnectivity();
  const offline = await getActiveSession();
  const reachable = await probe();

  if (reachable) {
    try {
      let jwt = getSession();
      if (!jwt && offline && checkOfflineSession(offline).ok) {
        const refreshed = await refreshWithDeviceSession();
        if (refreshed === 'ok') jwt = getSession();
      }
      let result = await fetchMe(jwt?.token ?? null);
      if (result.status === 401 && offline) {
        if ((await refreshWithDeviceSession()) === 'ok') result = await fetchMe(getSession()?.token ?? null);
      }
      if (result.status === 401) {
        clearSession();
        return { mode: 'login' };
      }
      if (result.status === 403) return { mode: 'blocked', message: result.detail ?? 'Access denied.' };
      if (!result.me) return offlineOrUnreachable(offline, allowed);
      const me = result.me;
      if (me.must_change_password) {
        // The server refuses everything else until the password is replaced (core/access.py).
        if (typeof window !== 'undefined') window.location.replace(CHANGE_PASSWORD_PATH);
        return { mode: 'blocked', message: 'Choose a new password to continue.' };
      }
      if (!allowed.includes(me.role)) return { mode: 'wrong-role', role: me.role };

      let session = offline && offline.userId === me.user_id ? offline : null;
      const renew = !session || Date.parse(session.expiresAt) - Date.now() < RENEW_BEFORE_MS;
      if (renew) session = (await provisionDevice(getSession()?.token)) ?? session;
      if (session) {
        openUserDb(session.userId);
        await touchSessionClock(session);
      }
      return { mode: 'online', me, offline: session };
    } catch {
      reportRequest(false);
      return offlineOrUnreachable(offline, allowed);
    }
  }
  return offlineOrUnreachable(offline, allowed);
}

async function offlineOrUnreachable(offline: OfflineSessionRecord | null, allowed: UserRole[]): Promise<Boot> {
  const check = checkOfflineSession(offline);
  if (!offline || !check.ok) return { mode: 'unreachable', reason: check.ok ? undefined : check.reason };
  // A token for a different person in this browser means the offline session isn't theirs.
  const jwt = getSession();
  if (jwt && jwt.userId && jwt.userId !== offline.userId) return { mode: 'unreachable', reason: 'missing' };
  if (!allowed.includes(offline.user.role)) return { mode: 'wrong-role', role: offline.user.role };
  openUserDb(offline.userId);
  await touchSessionClock(offline);
  return { mode: 'offline', session: offline };
}

/**
 * Sign out. Ends the offline session on the server when reachable and deletes this user's local data,
 * unless changes are still waiting to sync (then they're kept for the next sign-in, and `keptChanges`
 * says how many). Call `confirmSignOut` first to warn the user.
 */
export async function signOutEverywhere(): Promise<{ keptChanges: number }> {
  const session = await getActiveSession();
  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: bearer(token) });
    if (session) {
      await fetch('/api/v1/devices/session/revoke', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_identifier: session.deviceId, session_token: session.token }),
      });
    }
  } catch {
    /* offline: the server session expires on its own */
  }
  clearSession();
  let kept = 0;
  if (session) {
    kept = await unsyncedCount(session.userId);
    await forgetOfflineSession(session.userId);
    if (kept === 0) await deleteUserDb(session.userId);
    else await closeUserDb();
  }
  return { keptChanges: kept };
}
