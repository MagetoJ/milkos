'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { homeFor, loginUrl, type UserRole } from '@/lib/auth';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { OfflineProvider } from '@/components/offline/offline-provider';
import { ConnectionStatus, OfflineBanner, SyncStatus } from '@/components/offline/status';
import { bootSession, signOutEverywhere } from '@/lib/offline/auth';
import { syncEngine } from '@/lib/sync/engine';

type GuardState =
  | { status: 'checking' }
  | { status: 'unavailable'; reason?: string }
  | { status: 'blocked'; message: string }
  | { status: 'authorized'; email?: string; userId: string | null };

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

/**
 * Client-side route guard used by each dashboard's layout.tsx.
 *  - no session                          -> /login?next=<this page>
 *  - wrong role                          -> that role's own dashboard (never a login loop)
 *  - backend rejects the account         -> /login
 *  - backend unreachable + offline session (signed in online earlier on this device) -> works offline
 *  - backend unreachable, no offline session -> "retry" screen
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  useActiveRefresh(); // Automatically maintains 15-min token while user is active
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void bootSession(allowedRoles).then((boot) => {
      if (cancelled) return;
      if (boot.mode === 'login') return router.replace(loginUrl(pathname));
      if (boot.mode === 'wrong-role') return router.replace(homeFor(boot.role));
      if (boot.mode === 'blocked') return setState({ status: 'blocked', message: boot.message });
      if (boot.mode === 'unreachable') return setState({ status: 'unavailable', reason: boot.reason });
      if (boot.mode === 'online') return setState({ status: 'authorized', email: boot.me.email, userId: boot.offline?.userId ?? null });
      setState({ status: 'authorized', email: boot.session.user.email, userId: boot.session.userId });
    });
    return () => {
      cancelled = true;
    };
  }, [allowedRoles, pathname, router]);

  async function signOut() {
    const { pending, syncing, failed, conflict } = syncEngine.getState().counts;
    const waiting = pending + syncing + failed + conflict;
    if (waiting > 0 && !window.confirm(`You have ${waiting} unsynchronized record${waiting === 1 ? '' : 's'}. They stay on this device and sync after you sign in again. Sign out?`)) return;
    syncEngine.stop();
    await signOutEverywhere();
    window.location.assign('/login');
  }

  if (state.status === 'unavailable' || state.status === 'blocked') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center text-sm text-slate-600">
        <p className="max-w-md">
          {state.status === 'blocked'
            ? state.message
            : state.reason === 'expired'
              ? 'Cannot reach the MilkOS server, and offline access on this device has expired. Sign in again when you are online.'
              : 'Cannot reach the MilkOS server, and this device has not been set up for offline use for your account. Sign in once while online.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state.status !== 'authorized') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm font-medium">
        Verifying your session...
      </div>
    );
  }

  return (
    <OfflineProvider userId={state.userId}>
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
        <ConnectionStatus />
        {state.userId && <SyncStatus compact />}
        {state.email && <span>{state.email}</span>}
        <button onClick={() => void signOut()} className="font-semibold text-emerald-800 hover:underline">
          Sign out
        </button>
      </div>
      {state.userId && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-8">
          <OfflineBanner />
        </div>
      )}
      {children}
    </OfflineProvider>
  );
}
