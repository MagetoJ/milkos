'use client';

import { useCallback, useState } from 'react';

/**
 * The cooler a person is working at right now, remembered on this device (a display preference: it only decides which
 * cooler is shown in the header and pre-selected for a new collection; the collector still confirms it on every
 * collection and the server checks it belongs to their cooperative). Falls back to `fallbackId`, then to the first
 * available cooler, when nothing is saved or the saved cooler is no longer available.
 */
export function useWorkingCooler(scope: string, availableIds: string[], fallbackId?: string | null): [string | null, (id: string) => void] {
  const key = `milkos.cooler.${scope}`;
  // Read once on first render: this only runs in workspaces that render after the session loads in the browser.
  const [saved, setSaved] = useState<string | null>(() => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    } catch {
      return null; // storage unavailable: use the fallback
    }
  });

  const choose = useCallback((id: string) => {
    setSaved(id);
    try {
      window.localStorage.setItem(key, id);
    } catch {
      /* not remembered, still selected for this visit */
    }
  }, [key]);

  const current = [saved, fallbackId, availableIds[0]].find((id): id is string => !!id && availableIds.includes(id)) ?? null;
  return [current, choose];
}
