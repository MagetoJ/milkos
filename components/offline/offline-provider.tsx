'use client';

import { useEffect, type ReactNode } from 'react';
import { startConnectivity } from '@/lib/offline/connectivity';
import { syncEngine } from '@/lib/sync/engine';

/** Starts connectivity tracking and the sync engine for the signed-in user of a workspace. */
export function OfflineProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  useEffect(() => {
    startConnectivity();
    if (userId) void syncEngine.start(userId);
  }, [userId]);
  return <>{children}</>;
}
