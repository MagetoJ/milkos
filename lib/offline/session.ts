// Offline sessions: who may use this device without a connection, and until when.
//
// Only a user who signed in ONLINE gets one: the server issues it (POST /api/v1/devices/register) with an
// expiry, and it is stored in the local meta database (never a password). Offline, it is honoured until
// the expiry, never past it, and not if the device clock was turned back. The role and cooperative stored
// here only drive the UI; the server re-authorises every change when it syncs.
import { getMeta, metaDb, openUserDb, setMeta, userDbName } from './db';
import type { OfflineSessionRecord, OfflineUser } from './types';
import Dexie from 'dexie';

const ACTIVE_KEY = 'active_user';
/** Tolerated backwards clock movement (time zone/NTP corrections) before the session is distrusted. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface OfflineSessionResponse {
  token: string;
  issued_at: string;
  expires_at: string;
  device: { device_identifier: string };
  user: OfflineUser;
  permissions: string[];
}

export type SessionCheck = { ok: true } | { ok: false; reason: 'missing' | 'expired' | 'clock' };

export async function saveOfflineSession(response: OfflineSessionResponse): Promise<OfflineSessionRecord> {
  const now = Date.now();
  const previous = await metaDb().sessions.get(response.user.id);
  const record: OfflineSessionRecord = {
    userId: response.user.id,
    user: response.user,
    permissions: response.permissions,
    token: response.token,
    deviceId: response.device.device_identifier,
    issuedAt: response.issued_at,
    expiresAt: response.expires_at,
    lastOnlineAt: new Date(now).toISOString(),
    clockHighWater: Math.max(now, previous?.clockHighWater ?? 0),
  };
  await metaDb().sessions.put(record);
  await setMeta(metaDb(), ACTIVE_KEY, record.userId);
  return record;
}

/** Keep the expiry the server reports on every sync (sessions slide while used online). */
export async function extendOfflineSession(userId: string, expiresAt: string): Promise<void> {
  await metaDb().sessions.update(userId, { expiresAt, lastOnlineAt: new Date().toISOString() });
}

export async function getActiveSession(): Promise<OfflineSessionRecord | null> {
  const userId = await getMeta<string>(metaDb(), ACTIVE_KEY);
  if (!userId) return null;
  return (await metaDb().sessions.get(userId)) ?? null;
}

export function checkOfflineSession(record: OfflineSessionRecord | null, now = Date.now()): SessionCheck {
  if (!record) return { ok: false, reason: 'missing' };
  if (now + CLOCK_SKEW_MS < record.clockHighWater) return { ok: false, reason: 'clock' };
  if (Date.parse(record.expiresAt) <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** Remember the latest clock reading so a clock turned back can be noticed. */
export async function touchSessionClock(record: OfflineSessionRecord, now = Date.now()): Promise<void> {
  if (now > record.clockHighWater) await metaDb().sessions.update(record.userId, { clockHighWater: now });
}

export function hasPermission(record: OfflineSessionRecord | null, permission: string): boolean {
  return !!record?.permissions.includes(permission);
}

/** Number of changes in `userId`'s queue that haven't reached the server. */
export async function unsyncedCount(userId: string): Promise<number> {
  if (!(await Dexie.exists(userDbName(userId)))) return 0;
  return openUserDb(userId).queue.count();
}

export async function forgetOfflineSession(userId: string): Promise<void> {
  await metaDb().sessions.delete(userId);
  if ((await getMeta<string>(metaDb(), ACTIVE_KEY)) === userId) await metaDb().kv.delete(ACTIVE_KEY);
}

export function sessionExpiryLabel(record: Pick<OfflineSessionRecord, 'expiresAt'>, now = Date.now()): string {
  const ms = Date.parse(record.expiresAt) - now;
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}
