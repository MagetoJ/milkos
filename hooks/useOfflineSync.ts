'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/offline/db';
import { checkRealConnectivity, runSyncCycle } from '@/lib/offline/syncEngine';

export function useOfflineSync(accessToken?: string) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const pendingCount = useLiveQuery(
    () => db.syncQueue.where('status').anyOf(['pending', 'failed']).count(),
    [],
    0
  );

  const syncNow = useCallback(async () => {
    if (!accessToken || isSyncing) return;
    setIsSyncing(true);
    try {
      await runSyncCycle(accessToken);
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, isSyncing]);

  useEffect(() => {
    let mounted = true;

    const verifyConnection = async () => {
      const reachable = await checkRealConnectivity();
      if (!mounted) return;
      setIsOnline(reachable);
      if (reachable && accessToken) {
        syncNow();
      }
    };

    verifyConnection();
    window.addEventListener('online', verifyConnection);
    window.addEventListener('offline', () => setIsOnline(false));

    const interval = setInterval(verifyConnection, 30_000);

    return () => {
      mounted = false;
      window.removeEventListener('online', verifyConnection);
      window.removeEventListener('offline', () => setIsOnline(false));
      clearInterval(interval);
    };
  }, [accessToken, syncNow]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    syncNow,
  };
}
