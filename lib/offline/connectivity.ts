// Connectivity: "the device has a network" and "the MilkOS server answers" are tracked separately.
// navigator.onLine is only a hint (it is true on a Wi-Fi with no internet), so the server state comes from
// real requests: a health probe (/api/v1/health) plus the outcome of every API and sync call.

export type ServerState = 'unknown' | 'reachable' | 'unreachable';

export interface ConnectivityState {
  network: boolean;
  server: ServerState;
  lastCheckedAt: number | null;
  lastReachableAt: number | null;
}

type Listener = (state: ConnectivityState) => void;

const HEALTH_URL = '/api/v1/health';
const PROBE_TIMEOUT_MS = 5000;

let state: ConnectivityState = {
  network: typeof navigator === 'undefined' ? true : navigator.onLine,
  server: 'unknown',
  lastCheckedAt: null,
  lastReachableAt: null,
};
const listeners = new Set<Listener>();
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 10_000;
let probing: Promise<boolean> | null = null;

function set(next: Partial<ConnectivityState>) {
  const merged = { ...state, ...next };
  const changed = merged.network !== state.network || merged.server !== state.server;
  state = merged;
  // Only real transitions are announced (timestamps change on every request).
  if (changed) for (const listener of listeners) listener(state);
}

export function getConnectivity(): ConnectivityState {
  return state;
}

/** True when work can go to the server right now (best current knowledge). */
export function isServerReachable(): boolean {
  return state.network && state.server !== 'unreachable';
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record the outcome of a real request: any HTTP answer means reachable, a thrown fetch means not. */
export function reportRequest(ok: boolean) {
  const now = Date.now();
  if (ok) {
    retryDelay = 10_000;
    set({ server: 'reachable', network: true, lastCheckedAt: now, lastReachableAt: now });
  } else {
    set({ server: 'unreachable', lastCheckedAt: now });
    scheduleRetry();
  }
}

/** Ask the server directly. Resolves true when it answered. Concurrent calls share one request. */
export function probe(): Promise<boolean> {
  if (probing) return probing;
  probing = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      set({ network: false, server: 'unreachable', lastCheckedAt: Date.now() });
      scheduleRetry();
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(HEALTH_URL, { cache: 'no-store', signal: controller.signal });
      // The Next.js proxy answers 5xx when the API itself is down.
      const ok = res.ok;
      reportRequest(ok);
      return ok;
    } catch {
      reportRequest(false);
      return false;
    } finally {
      clearTimeout(timer);
      probing = null;
    }
  })();
  return probing;
}

function scheduleRetry() {
  if (!started || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, 120_000);
    void probe();
  }, retryDelay);
}

/** Start listening to the browser's online/offline events (idempotent, browser only). */
export function startConnectivity() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => {
    set({ network: true });
    retryDelay = 10_000;
    void probe();
  });
  window.addEventListener('offline', () => set({ network: false, server: 'unreachable', lastCheckedAt: Date.now() }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.server !== 'reachable') void probe();
  });
}

/** Test hook. */
export function resetConnectivity(next?: Partial<ConnectivityState>) {
  state = { network: true, server: 'unknown', lastCheckedAt: null, lastReachableAt: null, ...next };
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 10_000;
}
