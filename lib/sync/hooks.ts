'use client';

// React bindings for the offline platform. State lives in the engine / IndexedDB; components subscribe.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getConnectivity, subscribeConnectivity, type ConnectivityState } from '@/lib/offline/connectivity';
import { onLocalChange } from '@/lib/offline/events';
import type { LocalTable } from '@/lib/offline/types';
import { syncEngine, type SyncState } from './engine';

const SERVER_CONNECTIVITY: ConnectivityState = { network: true, server: 'unknown', lastCheckedAt: null, lastReachableAt: null };

export function useConnectivity(): ConnectivityState {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, () => SERVER_CONNECTIVITY);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getState, syncEngine.getState);
}

/** True when the MilkOS server is (as far as we know) reachable. */
export function useIsOnline(): boolean {
  const c = useConnectivity();
  return c.network && c.server !== 'unreachable';
}

/**
 * Run a query against the local database and re-run it whenever one of `tables` changes locally
 * (an offline edit, a pull, a sync result) or one of `deps` changes. Like useResource, but for IndexedDB.
 */
export function useLocalQuery<T>(query: () => Promise<T>, tables: (LocalTable | 'queue')[], deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  const depsKey = JSON.stringify(deps);
  const tablesKey = tables.join(',');

  useEffect(() => {
    let cancelled = false;
    queryRef.current().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read local data.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [depsKey, version]);

  useEffect(() => {
    const key = new Set(tablesKey.split(','));
    return onLocalChange((changed) => {
      if ([...changed].some((t) => key.has(t))) setVersion((v) => v + 1);
    });
  }, [tablesKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

/** "2 minutes ago" that keeps itself current. */
export function useRelativeTime(iso: string | null | undefined): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  return relativeTime(iso);
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(seconds)) return 'unknown';
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Call `reload` whenever one of `tables` changes in the local database (sync results, other screens). */
export function useReloadOn(tables: (LocalTable | 'queue')[], reload: () => unknown) {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  const tablesKey = tables.join(',');
  useEffect(() => {
    const key = new Set(tablesKey.split(','));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onLocalChange((changed) => {
      if (![...changed].some((t) => key.has(t))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ref.current(), 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [tablesKey]);
}

/** The current time, refreshed every `intervalMs` (for "live"/"stale" labels). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
