'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { ToastProvider } from '@/app/superadmin/_components/toast';
import { OfflineProvider } from '@/components/offline/offline-provider';
import { homeFor, loginUrl } from '@/lib/auth';
import { bootSession, type Boot } from '@/lib/offline/auth';
import { sessionExpiryLabel } from '@/lib/offline/session';
import { syncEngine } from '@/lib/sync/engine';
import { useIsOnline, useSyncState } from '@/lib/sync/hooks';
import { ApiError, getOverview } from './_api/coop-client';
import { CoopProvider } from './_components/coop-context';
import { CoopShell, signOut } from './_components/coop-shell';
import type { Overview } from './_types/coop-types';

type State =
  | { status: 'checking' }
  | { status: 'unreachable'; reason?: string }
  | { status: 'blocked'; message: string }
  | { status: 'ok'; overview: Overview; email?: string; userId: string | null; offlineUntil: string | null };

const UNREACHABLE: Record<string, string> = {
  expired: 'Your offline access on this device has expired. Connect to the internet and sign in again.',
  clock: 'This device’s clock was changed, so offline access is paused. Connect to the internet to continue.',
  missing: 'This device hasn’t been set up for offline use for your account. Sign in once while online.',
};

/**
 * Confirms the session before showing anything.
 *   server reachable                    -> the server confirms the account (overview doubles as the access check)
 *   server unreachable + offline session -> offline mode on this device's data
 *   server unreachable + no session     -> "can't reach the server" (nobody gets in offline without signing in online first)
 * Redirects use window.location so they can't fire before the App Router is initialised.
 */
export default function CooperativesLayout({ children }: { children: ReactNode }) {
  useActiveRefresh(); // keeps the 15-minute token alive while the user is active
  const pathname = usePathname();
  const [state, setState] = useState<State>({ status: 'checking' });

  const loadOverview = useCallback(async (boot: Exclude<Boot, { mode: 'login' | 'wrong-role' | 'blocked' | 'unreachable' }>) => {
    const email = boot.mode === 'online' ? boot.me.email : boot.session.user.email;
    const userId = boot.mode === 'online' ? (boot.offline?.userId ?? null) : boot.session.userId;
    const offlineUntil = boot.mode === 'online' ? (boot.offline?.expiresAt ?? null) : boot.session.expiresAt;
    try {
      setState({ status: 'ok', overview: await getOverview(), email, userId, offlineUntil });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // request() is already redirecting to /login
      if (e instanceof ApiError && e.status === 403) return setState({ status: 'blocked', message: e.message });
      setState({ status: 'unreachable' });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const boot = await bootSession(['COOP_ADMIN', 'MANAGER']);
      if (boot.mode === 'login') return window.location.replace(loginUrl(pathname));
      if (boot.mode === 'wrong-role') return window.location.replace(homeFor(boot.role));
      if (boot.mode === 'blocked') return setState({ status: 'blocked', message: boot.message });
      if (boot.mode === 'unreachable') return setState({ status: 'unreachable', reason: boot.reason });
      await loadOverview(boot);
    })();
    // Only on first load; later refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'unreachable') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F6F7F4] px-6 text-center text-sm text-[#5E6B64]">
        <p className="max-w-md">Can&apos;t reach the MilkOS server. {state.reason ? UNREACHABLE[state.reason] : ''}</p>
        <button onClick={() => window.location.reload()} className="rounded-md bg-[#176044] px-3 py-1.5 font-medium text-white hover:bg-[#124D37]">
          Try again
        </button>
      </div>
    );
  }

  if (state.status === 'blocked') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F6F7F4] px-6 text-center text-sm text-[#5E6B64]">
        <p className="max-w-md">{state.message}</p>
        <button onClick={signOut} className="rounded-md bg-[#176044] px-3 py-1.5 font-medium text-white hover:bg-[#124D37]">
          Sign out
        </button>
      </div>
    );
  }

  if (state.status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center bg-[#F6F7F4] text-sm text-[#5E6B64]">Checking your access…</div>;
  }

  return (
    <ToastProvider>
      <OfflineProvider userId={state.userId}>
        <Workspace
          state={state}
          refresh={async () => {
            try {
              const overview = await getOverview();
              setState((s) => (s.status === 'ok' ? { ...s, overview } : s));
            } catch {
              /* keep what is shown */
            }
          }}
        >
          {children}
        </Workspace>
      </OfflineProvider>
    </ToastProvider>
  );
}

function Workspace({
  state,
  refresh,
  children,
}: {
  state: Extract<State, { status: 'ok' }>;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const isOnline = useIsOnline();
  const sync = useSyncState();

  // Coming back online (or finishing a sync) refreshes the dashboard numbers from the server.
  useEffect(() => {
    if (isOnline && state.overview.offline) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, sync.lastSyncAt]);

  return (
    <CoopProvider
      value={{
        overview: state.overview,
        email: state.email,
        canManageTeam: state.overview.role === 'COOP_ADMIN',
        refresh,
        isOnline,
        offlineCapable: !!state.userId,
        offlineAccess: state.offlineUntil ? sessionExpiryLabel({ expiresAt: state.offlineUntil }) : null,
        syncStatus: sync.phase,
        pendingCount: sync.counts.pending + sync.counts.syncing,
        lastSyncAt: sync.lastSyncAt,
        syncNow: () => syncEngine.syncNow({ force: true }),
      }}
    >
      <CoopShell>{children}</CoopShell>
    </CoopProvider>
  );
}
