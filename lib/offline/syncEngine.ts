import { db } from './db';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'\;

export async function checkRealConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_BASE}/health`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function runSyncCycle(accessToken: string): Promise<{
  pushed: number;
  pulledFarmers: number;
}> {
  const isOnline = await checkRealConnectivity();
  if (!isOnline) return { pushed: 0, pulledFarmers: 0 };

  const pendingItems = await db.syncQueue
    .where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('id');

  let pushedCount = 0;

  if (pendingItems.length > 0) {
    const res = await fetch(`${API_BASE}/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ mutations: pendingItems }),
    });

    if (res.ok) {
      const { results } = await res.json();
      await db.transaction('rw', db.collections, db.syncQueue, async () => {
        for (const item of results) {
          if (item.status === 'ok') {
            await db.syncQueue.delete(item.queue_id);
            const remaining = await db.syncQueue
              .where('client_tx_id')
              .equals(item.client_tx_id)
              .count();
            if (remaining === 0) {
              await db.collections.update(item.client_tx_id, {
                sync_status: 'synced',
                server_id: item.server_id,
              });
            }
            pushedCount++;
          } else {
            await db.syncQueue.update(item.queue_id, {
              status: 'failed',
              last_error: item.error || 'Sync rejected by server',
            });
          }
        }
      });
    }
  }

  const lastPull = await db.syncMeta.get('last_pull_timestamp');
  const sinceParam = lastPull ? `?since=${encodeURIComponent(lastPull.value)}` : '';

  const pullRes = await fetch(`${API_BASE}/sync/pull${sinceParam}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let pulledFarmers = 0;
  if (pullRes.ok) {
    const { farmers, server_time } = await pullRes.json();
    await db.transaction('rw', db.farmers, db.syncMeta, async () => {
      if (farmers?.length) {
        await db.farmers.bulkPut(farmers);
        pulledFarmers = farmers.length;
      }
      if (server_time) {
        await db.syncMeta.put({ key: 'last_pull_timestamp', value: server_time });
      }
    });
  }

  return { pushed: pushedCount, pulledFarmers };
}
