// The device's identity: a random UUID created on first start and kept in the local meta database.
// No browser fingerprinting. Clearing site data creates a new device (the old one simply stops syncing).
import { getMeta, metaDb, setMeta } from './db';
import { uuid } from './ids';

const KEY = 'device_id';
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const db = metaDb();
  let id = await getMeta<string>(db, KEY);
  if (!id) {
    id = uuid();
    await setMeta(db, KEY, id);
  }
  cached = id;
  return id;
}

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

export function devicePlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const platform = nav.userAgentData?.platform || navigator.platform || 'web';
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
  return `${platform}${nav.userAgentData?.mobile ? ' mobile' : ''}${standalone ? ' (installed)' : ' (browser)'}`.slice(0, 100);
}

/** Test hook: forget the cached id. */
export function resetDeviceIdCache() {
  cached = null;
}
