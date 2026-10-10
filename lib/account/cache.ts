// Offline copy of the account's NON-sensitive settings: profile details and preferences, so settings screens open
// without a connection. Kept in the shared meta database under the user's id.
//
// Never cached (and stripped here even if a response carried them): passwords, codes, activation or reset tokens,
// access tokens, MFA secrets and recovery codes. Changing anything security-related needs the server.
import { getMeta, metaDb, setMeta } from '@/lib/offline/db';
import type { AccountProfile, Preferences } from './api';

const FORBIDDEN = new Set(['access_token', 'password', 'current_password', 'new_password', 'code', 'token', 'secret', 'otpauth_uri', 'recovery_codes', 'mfa_token']);

export interface CachedAccount {
  profile: AccountProfile | null;
  preferences: Preferences | null;
  savedAt: string;
}

/** A copy of `value` with every secret-bearing key removed, at any depth. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}

const key = (userId: string) => `account:${userId}`;

export async function readCachedAccount(userId: string): Promise<CachedAccount | null> {
  try {
    return (await getMeta<CachedAccount>(metaDb(), key(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function cacheAccount(userId: string, data: { profile?: AccountProfile | null; preferences?: Preferences | null }): Promise<void> {
  try {
    const current = await readCachedAccount(userId);
    await setMeta(metaDb(), key(userId), {
      profile: stripSecrets(data.profile ?? current?.profile ?? null),
      preferences: stripSecrets(data.preferences ?? current?.preferences ?? null),
      savedAt: new Date().toISOString(),
    } satisfies CachedAccount);
  } catch {
    /* IndexedDB unavailable (private mode): settings still work online */
  }
}

export async function forgetCachedAccount(userId: string): Promise<void> {
  try {
    await metaDb().kv.delete(key(userId));
  } catch {
    /* nothing to forget */
  }
}
