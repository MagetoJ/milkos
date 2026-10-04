'use client';

// Connection and sync indicators. Offline is a normal way of working, so these are calm, not alarming.
import { AlertTriangle, CircleDot, CloudOff, RefreshCw } from 'lucide-react';
import { StatusBadge } from '@/components/admin';
import { userDb } from '@/lib/offline/db';
import { syncEngine } from '@/lib/sync/engine';
import { retryNow } from '@/lib/sync/queue';
import { useConnectivity, useRelativeTime, useSyncState } from '@/lib/sync/hooks';
import type { SyncStatus as RecordSync } from '@/app/superadmin/_types/platform-types';

/** ● Connected / ○ Working offline, with when it last synced. */
export function ConnectionStatus({ dark = false }: { dark?: boolean }) {
  const c = useConnectivity();
  const sync = useSyncState();
  const lastSynced = useRelativeTime(sync.lastSyncAt);
  const online = c.network && c.server === 'reachable';
  const checking = c.network && c.server === 'unknown';
  const muted = dark ? 'text-[#9DB8A8]' : 'text-[#8A968F]';
  return (
    <div className="text-xs" role="status" aria-live="polite">
      <p className={`flex items-center gap-1.5 font-medium ${dark ? 'text-white/90' : 'text-[#17221D]'}`}>
        <span
          aria-hidden
          className={`inline-block size-2 rounded-full ${online ? 'bg-[#3BA272]' : checking ? 'bg-[#C9D2CC]' : 'border border-current bg-transparent'}`}
        />
        {online ? 'Connected' : checking ? 'Checking connection…' : c.network ? 'Server unreachable · working offline' : 'Working offline'}
      </p>
      <p className={muted}>Last synced {lastSynced}</p>
    </div>
  );
}

/** Pending / syncing / failed / conflicts summary with the main actions. */
export function SyncStatus({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const sync = useSyncState();
  const { pending, syncing, failed, conflict } = sync.counts;
  const waiting = pending + syncing;
  const text = dark ? 'text-[#DCE8E0]' : 'text-[#5E6B64]';
  const link = dark ? 'text-white underline-offset-2 hover:underline' : 'font-medium text-[#176044] hover:underline';

  let line: React.ReactNode;
  if (sync.phase === 'syncing') {
    line = (
      <span className="flex items-center gap-1.5">
        <RefreshCw aria-hidden className="size-3 animate-spin" /> Synchronizing{waiting ? ` ${waiting} record${waiting === 1 ? '' : 's'}` : ''}…
      </span>
    );
  } else if (sync.phase === 'auth-required') {
    line = <span>Sign in again to sync {waiting} waiting record{waiting === 1 ? '' : 's'}.</span>;
  } else if (sync.phase === 'blocked') {
    line = <span>{sync.lastError ?? 'This device can’t sync.'}</span>;
  } else if (waiting) {
    line = <span>{waiting} record{waiting === 1 ? '' : 's'} waiting to sync</span>;
  } else if (sync.userId) {
    line = <span>All changes synced</span>;
  } else {
    return null;
  }

  return (
    <div className={`space-y-1 text-xs ${text}`}>
      <p>{line}</p>
      {failed > 0 && (
        <p className="flex items-center gap-1.5 font-medium text-[#D9822B]">
          <AlertTriangle aria-hidden className="size-3" /> {failed} record{failed === 1 ? '' : 's'} failed
        </p>
      )}
      {conflict > 0 && (
        <p className="flex items-center gap-1.5 font-medium text-[#D9822B]">
          <AlertTriangle aria-hidden className="size-3" /> {conflict} record{conflict === 1 ? ' needs' : 's need'} review
        </p>
      )}
      {!compact && (
        <p className="flex gap-3">
          <button type="button" className={link} onClick={() => void syncEngine.syncNow({ force: true })} disabled={sync.phase === 'syncing'}>
            Sync now
          </button>
          {failed > 0 && (
            <button
              type="button"
              className={link}
              onClick={async () => {
                await retryNow(userDb());
                void syncEngine.syncNow({ force: true });
              }}
            >
              Retry failed
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Subtle banner while working offline. */
export function OfflineBanner() {
  const c = useConnectivity();
  const sync = useSyncState();
  const offline = !c.network || c.server === 'unreachable';
  if (!offline && sync.phase !== 'auth-required') return null;
  if (sync.phase === 'auth-required') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-[#F1D9A6] bg-[#FBF1DC] px-4 py-3 text-sm text-[#5C3D06]">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">Your session has ended.</span> Your changes are saved on this device.{' '}
          <a href="/login" className="font-medium underline">Sign in again</a> to sync them.
        </p>
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-[#DDE3DE] bg-white px-4 py-3 text-sm text-[#3C4A43]">
      <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-[#5E6B64]" />
      <p>
        <span className="font-medium">You&apos;re offline.</span> MilkOS is using the data on this device. Changes will sync
        automatically when the connection returns.
        {sync.counts.pending > 0 && <span className="text-[#5E6B64]"> {sync.counts.pending} waiting.</span>}
      </p>
    </div>
  );
}

const PILL: Record<Exclude<RecordSync, 'synced'>, { label: string; tone: 'amber' | 'red' | 'blue' }> = {
  pending: { label: 'Pending sync', tone: 'amber' },
  syncing: { label: 'Syncing…', tone: 'blue' },
  failed: { label: 'Sync failed', tone: 'red' },
  conflict: { label: 'Needs review', tone: 'red' },
};

/** Shown next to a record that hasn't reached the server yet. Nothing for synced records. */
export function SyncPill({ status, error }: { status?: RecordSync | null; error?: string | null }) {
  if (!status || status === 'synced') return null;
  const pill = PILL[status];
  return (
    <span title={error ?? undefined}>
      <StatusBadge status={status} label={pill.label} tone={pill.tone} />
    </span>
  );
}

/** "Showing data saved on this device" note for screens rendered from local data while offline. */
export function LocalDataNote({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-[#8A968F]">
      <CircleDot aria-hidden className="size-3" /> Offline values from this device’s last sync
    </p>
  );
}
