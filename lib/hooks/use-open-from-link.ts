'use client';

import { useEffect, useRef } from 'react';

/**
 * Quick-action links such as `/cooperatives/farmers?new=1` open the create form on arrival. Once `enabled` (the
 * person may do it and the data it needs has loaded), calls `onOpen` with the value of `?new=` and removes the
 * parameter so a refresh or the back button does not reopen it.
 */
export function useOpenFromLink(enabled: boolean, onOpen: (value: string) => void) {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(() => {
    if (!enabled) return;
    const value = new URLSearchParams(window.location.search).get('new');
    if (!value) return;
    window.history.replaceState(null, '', window.location.pathname);
    latest.current(value);
  }, [enabled]);
}
