'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { ToastProvider } from '@/app/superadmin/_components/toast';
import { OfflineProvider } from '@/components/offline/offline-provider';
import { homeFor, loginUrl, ROUTE_ACCESS } from '@/lib/auth';
import { bootSession, signOutEverywhere } from '@/lib/offline/auth';
import { syncEngine } from '@/lib/sync/engine';
import { CollectorShell } from './_components/collector-shell';
import { CollectorProvider } from './_components/collector-context';

type State =
  | { status: 'checking' }
  | { status: 'unavailable'; message: string }
  | { status: 'ok'; userId: string | null; name: string | null; cooperativeName: string | null; role: string; offline: boolean };

const UNREACHABLE: Record<string, string> = {
  expired: 'Offline access on this phone has expired. Connect to the internet and sign in again.',
  clock: 'This phone’s clock was changed, so offline access is paused. Connect to the internet to continue.',
  missing: 'This phone hasn’t been set up for offline use for your account. Sign in once while online.',
};

/** Collector app: works offline once the collector has signed in online on this phone. */
export default function CollectorLayout({ children }: { children: ReactNode }) {
  useActiveRefresh();
  const pathname = usePathname();
  const [state, setState] = useState<State>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void bootSession(ROUTE_ACCESS['/collector']).then((boot) => {
      if (cancelled) return;
      if (boot.mode === 'login') return window.location.replace(loginUrl(pathname));
      if (boot.mode === 'wrong-role') return window.location.replace(homeFor(boot.role));
      if (boot.mode === 'blocked') return setState({ status: 'unavailable', message: boot.message });
      if (boot.mode === 'unreachable') {
        return setState({ status: 'unavailable', message: `Can't reach the MilkOS server. ${UNREACHABLE[boot.reason ?? 'missing']}` });
      }
      if (boot.mode === 'online') {
        setState({
          status: 'ok', userId: boot.offline?.userId ?? null, name: boot.me.full_name,
          cooperativeName: boot.offline?.user.cooperative_name ?? null, role: boot.me.role, offline: false,
        });
      } else {
        setState({
          status: 'ok', userId: boot.session.userId, name: boot.session.user.full_name,
          cooperativeName: boot.session.user.cooperative_name, role: boot.session.user.role, offline: true,
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    const { pending, syncing, failed, conflict } = syncEngine.getState().counts;
    const waiting = pending + syncing + failed + conflict;
    if (waiting > 0 && !window.confirm(`You have ${waiting} unsynced record${waiting === 1 ? '' : 's'}. They stay on this phone and sync after you sign in again. Sign out?`)) return;
    syncEngine.stop();
    await signOutEverywhere();
    window.location.assign('/login');
  }

  if (state.status === 'checking') {
    return <div className="flex min-h-dvh items-center justify-center bg-[#F6F7F4] text-sm text-[#5E6B64]" role="status">Checking your access…</div>;
  }
  if (state.status === 'unavailable') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#F6F7F4] px-6 text-center text-[#3C4A43]">
        <p className="max-w-sm">{state.message}</p>
        <button onClick={() => window.location.reload()} className="min-h-12 rounded-xl bg-[#176044] px-5 font-semibold text-white">
          Try again
        </button>
      </div>
    );
  }
  return (
    <ToastProvider>
      <OfflineProvider userId={state.userId}>
        <CollectorProvider value={{ userId: state.userId, name: state.name, role: state.role, offlineCapable: !!state.userId }}>
          <CollectorShell cooperativeName={state.cooperativeName} userName={state.name} onSignOut={() => void signOut()}>
            {children}
          </CollectorShell>
        </CollectorProvider>
      </OfflineProvider>
    </ToastProvider>
  );
}
