'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { ToastProvider } from '@/app/superadmin/_components/toast';
import { canAccess, getSession, homeFor, loginUrl } from '@/lib/auth';
import { ApiError, getOverview } from './_api/coop-client';
import { CoopProvider } from './_components/coop-context';
import { CoopShell, signOut } from './_components/coop-shell';
import type { Overview } from './_types/coop-types';

type State =
  | { status: 'checking' }
  | { status: 'offline' }
  | { status: 'blocked'; message: string }
  | { status: 'ok'; overview: Overview };

/**
 * Confirms the session with the backend before showing anything. The overview request doubles as the
 * access check: it only succeeds for an active COOP_ADMIN / MANAGER whose cooperative is active.
 * Redirects use window.location so they can't fire before the App Router is initialised.
 */
export default function CooperativesLayout({ children }: { children: ReactNode }) {
  useActiveRefresh(); // keeps the 15-minute token alive while the user is active
  const pathname = usePathname();
  const [state, setState] = useState<State>({ status: 'checking' });
  const [email, setEmail] = useState<string>();

  const load = useCallback(async () => {
    try {
      setState({ status: 'ok', overview: await getOverview() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // request() is already redirecting to /login
      if (e instanceof ApiError && e.status === 403) return setState({ status: 'blocked', message: e.message });
      setState({ status: 'offline' });
    }
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) return window.location.replace(loginUrl(pathname));
    if (!canAccess(session.role, '/cooperatives')) return window.location.replace(homeFor(session.role));
    setEmail(session.email);
    void load();
    // Only on first load; later refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'offline') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F6F7F4] text-sm text-[#5E6B64]">
        <p>Can&apos;t reach the Milkflow API to confirm your session.</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-[#176044] px-3 py-1.5 font-medium text-white hover:bg-[#124D37]"
        >
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
      <CoopProvider value={{ overview: state.overview, email, canManageTeam: state.overview.role === 'COOP_ADMIN', refresh: load }}>
        <CoopShell>{children}</CoopShell>
      </CoopProvider>
    </ToastProvider>
  );
}