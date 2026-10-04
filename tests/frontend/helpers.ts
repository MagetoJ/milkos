import { afterEach, beforeEach, vi } from 'vitest';
import { resetDatabasesForTests } from '@/lib/offline/db';
import { resetConnectivity } from '@/lib/offline/connectivity';
import { resetDeviceIdCache } from '@/lib/offline/device';
import { syncEngine } from '@/lib/sync/engine';

/** Fresh databases, connectivity and engine for every test. */
export function withCleanState() {
  beforeEach(async () => {
    syncEngine.stop();
    await resetDatabasesForTests();
    resetDeviceIdCache();
    resetConnectivity({ server: 'unknown', network: true });
    localStorage.clear();
    (navigator as { onLine: boolean }).onLine = true;
  });
  afterEach(() => {
    syncEngine.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
