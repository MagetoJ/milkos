'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Whether a workspace's sidebar is collapsed to icons, remembered on this device (a display preference only:
 * nothing sensitive is kept). Starts expanded until the saved value is read, so server and client render alike.
 */
export function useSidebarCollapsed(workspace: string): [boolean, () => void] {
  const key = `milkos.sidebar.${workspace}`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(key) === 'collapsed');
    } catch {
      /* storage unavailable: stay expanded */
    }
  }, [key]);

  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(key, next ? 'collapsed' : 'expanded');
      } catch {
        /* not remembered, still toggled */
      }
      return next;
    });
  }, [key]);

  return [collapsed, toggle];
}
