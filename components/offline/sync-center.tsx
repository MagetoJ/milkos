'use client';

// Sync Center: the state of this device's data, what's waiting, what failed and what needs a decision.
import { useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmationDialog, EmptyState, StatusBadge, primaryButton, secondaryButton } from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { getMeta, userDb } from '@/lib/offline/db';
import { signOutEverywhere } from '@/lib/offline/auth';
import { getActiveSession, sessionExpiryLabel } from '@/lib/offline/session';
import type { QueueItem } from '@/lib/offline/types';
import { resolveConflict } from '@/lib/sync/api';
import { syncEngine } from '@/lib/sync/engine';
import { useConnectivity, useLocalQuery, useRelativeTime, useSyncState } from '@/lib/sync/hooks';
import { discardItem, listQueue, retryNow } from '@/lib/sync/queue';

const ENTITY_LABEL: Record<string, string> = {
  farmer: 'Farmer',
  centre: 'Collection centre',
  collection: 'Milk collection',
  cooler_reading: 'Cooler reading',
  sensor_event: 'Sensor connection',
};

function describe(item: QueueItem): string {
  const p = item.payload as Record<string, unknown>;
  const what = ENTITY_LABEL[item.entity_type] ?? item.entity_type;
  if (item.entity_type === 'farmer') return `${what} ${item.operation === 'create' ? 'added' : 'edited'}: ${[p.first_name, p.last_name].filter(Boolean).join(' ') || '(no name change)'}`;
  if (item.entity_type === 'collection') return `${what}: ${p.quantity_litres ?? '?'} L on ${p.collection_date ?? ''}`;
  if (item.entity_type === 'cooler_reading') return `${what}: ${p.volume_litres ?? '–'} L at ${new Date(String(p.measured_at)).toLocaleString()}`;
  if (item.entity_type === 'centre') return `${what} ${item.operation === 'create' ? 'added' : 'edited'}: ${p.name ?? ''}`;
  return `${what} (${p.event ?? item.operation})`;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-sm text-[#5E6B64]">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-[#9A5B00]' : ''}`}>{value}</dd>
    </div>
  );
}

export function SyncCenter() {
  const toast = useToast();
  const sync = useSyncState();
  const c = useConnectivity();
  const lastSync = useRelativeTime(sync.lastSyncAt);
  const lastPull = useRelativeTime(sync.lastPullAt);
  const lastPush = useRelativeTime(sync.lastPushAt);
  const [confirmClear, setConfirmClear] = useState(false);
  const queue = useLocalQuery(() => listQueue(userDb()), ['queue']);
  const sensorSync = useLocalQuery(
    async () => {
      const synced = await userDb().readings.filter((r) => r._status === 'synced' && !!r._last_synced_at).toArray();
      return synced.reduce<string | null>((max, r) => (!max || String(r._last_synced_at) > max ? String(r._last_synced_at) : max), null);
    },
    ['readings'],
  );
  const session = useLocalQuery(() => getActiveSession(), ['queue']);
  const syncWindow = useLocalQuery(() => getMeta<{ collection_days: number; reading_days: number }>(userDb(), 'window'), ['queue']);
  const lastSensor = useRelativeTime(sensorSync.data);

  const items = queue.data ?? [];
  const attention = items.filter((i) => i.status === 'failed' || i.status === 'conflict');
  const online = c.network && c.server === 'reachable';

  async function discard(item: QueueItem) {
    await discardItem(userDb(), item.mutation_id);
    if (online) await resolveConflict(item.mutation_id, 'discarded').catch(() => undefined);
    toast('Change discarded. The server’s version is kept.');
  }

  async function retry(item: QueueItem) {
    await retryNow(userDb(), [item.mutation_id]);
    if (online) await resolveConflict(item.mutation_id, 'retried').catch(() => undefined);
    void syncEngine.syncNow({ force: true });
  }

  function exportUnsynced() {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), user: session.data?.user.email, items }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `milkos-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearLocalData() {
    setConfirmClear(false);
    await signOutEverywhere();
    window.location.assign('/login');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE3DE] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1EC] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Sync status</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#5E6B64]">
              <span aria-hidden className={`inline-block size-2 rounded-full ${online ? 'bg-[#3BA272]' : 'border border-[#5E6B64]'}`} />
              {online ? 'Online' : 'Offline'}
              {sync.phase === 'syncing' && ' · synchronizing…'}
              {sync.phase === 'auth-required' && ' · sign in again to sync'}
              {sync.phase === 'blocked' && ` · ${sync.lastError}`}
              {sync.phase === 'error' && ` · ${sync.lastError}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={secondaryButton} onClick={() => void retryNow(userDb()).then(() => syncEngine.syncNow({ force: true }))} disabled={sync.counts.failed === 0}>
              Retry failed
            </button>
            <button className={primaryButton} onClick={() => void syncEngine.syncNow({ force: true })} disabled={sync.phase === 'syncing'}>
              <RefreshCw className={`size-4 ${sync.phase === 'syncing' ? 'animate-spin' : ''}`} /> Sync now
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4">
          <Stat label="Last synced" value={<span className="text-base">{lastSync}</span>} />
          <Stat label="Pending" value={sync.counts.pending + sync.counts.syncing} />
          <Stat label="Failed" value={sync.counts.failed} tone={sync.counts.failed ? 'warn' : undefined} />
          <Stat label="Conflicts" value={sync.counts.conflict} tone={sync.counts.conflict ? 'warn' : undefined} />
        </dl>
        <dl className="grid gap-x-6 gap-y-2 border-t border-[#EEF1EC] px-5 py-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt className="text-[#5E6B64]">Last server sync (sent)</dt><dd>{lastPush}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-[#5E6B64]">Last server sync (received)</dt><dd>{lastPull}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-[#5E6B64]">Last sensor reading synced</dt><dd>{lastSensor}</dd></div>
          <div className="flex justify-between gap-2">
            <dt className="text-[#5E6B64]">Offline access remaining</dt>
            <dd>{session.data ? sessionExpiryLabel(session.data) : '–'}</dd>
          </div>
          {syncWindow.data && (
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="text-[#5E6B64]">History kept on this device</dt>
              <dd>collections {syncWindow.data.collection_days} days · cooler readings {syncWindow.data.reading_days} days</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-xl border border-[#DDE3DE] bg-white">
        <h2 className="px-5 pb-2 pt-5 text-base font-semibold">Needs review</h2>
        {attention.length === 0 ? (
          <EmptyState title="Nothing to review" body="Records that the server refuses or that changed on the server meanwhile appear here." />
        ) : (
          <ul className="divide-y divide-[#EEF1EC]">
            {attention.map((item) => (
              <li key={item.mutation_id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{describe(item)}</p>
                  <p className="mt-0.5 text-[#5E6B64]">
                    <StatusBadge status={item.status} label={item.status === 'conflict' ? 'Needs review' : 'Sync failed'} tone="red" />{' '}
                    {item.last_error?.message}
                  </p>
                  {item.last_error && Object.keys(item.last_error.fields).length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-[#5E6B64]">
                      {Object.entries(item.last_error.fields).map(([field, msg]) => (
                        <li key={field}>{field.replace(/_/g, ' ')}: {msg}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 gap-3 font-medium">
                  <button className="text-[#176044] hover:underline" onClick={() => void retry(item)}>Retry</button>
                  <button className="text-[#B42318] hover:underline" onClick={() => void discard(item)}>Discard my change</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[#DDE3DE] bg-white px-5 py-4">
        <h2 className="text-base font-semibold">Waiting to sync</h2>
        {items.filter((i) => i.status === 'pending' || i.status === 'syncing').length === 0 ? (
          <p className="mt-1 text-sm text-[#5E6B64]">Nothing is waiting. Every change on this device has reached the server.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {items
              .filter((i) => i.status === 'pending' || i.status === 'syncing')
              .slice(0, 50)
              .map((i) => (
                <li key={i.mutation_id} className="flex justify-between gap-3">
                  <span className="truncate">{describe(i)}</span>
                  <span className="shrink-0 text-xs text-[#8A968F]">{i.attempts ? `${i.attempts} attempt${i.attempts === 1 ? '' : 's'}` : 'queued'}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#EEF1EC] pt-4">
          <button className={secondaryButton} onClick={exportUnsynced} disabled={items.length === 0}>
            <Download className="size-4" /> Export unsynced records
          </button>
          <button className={secondaryButton} onClick={() => setConfirmClear(true)}>
            <Trash2 className="size-4" /> Sign out and clear this device
          </button>
        </div>
      </section>

      {confirmClear && (
        <ConfirmationDialog
          title="Clear MilkOS data on this device?"
          body={
            items.length > 0
              ? `You have ${items.length} unsynchronized record${items.length === 1 ? '' : 's'}. They will be KEPT on this device until you sign in again and they sync; everything else is removed. Export them first if you need a copy.`
              : 'All your changes have synced. This signs you out and removes the cooperative data stored on this device.'
          }
          confirmLabel="Sign out and clear"
          danger
          onConfirm={clearLocalData}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
