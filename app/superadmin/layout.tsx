'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AdminShell } from './_components/admin-shell';
import { SuperadminDataProvider } from './_components/superadmin-data';
import { ToastProvider } from './_components/toast';
import { SuperadminOffline } from './_components/superadmin-offline';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { OfflineProvider } from '@/components/offline/offline-provider';
import { homeFor, loginUrl } from '@/lib/auth';
import { bootSession } from '@/lib/offline/auth';
import type { OfflineSessionRecord } from '@/lib/offline/types';

type GuardState =
  | { status: 'checking' }
  | { status: 'unreachable' }
  | { status: 'cached'; session: OfflineSessionRecord }
  | { status: 'ok'; email?: string; userId: string | null };

/**
 * Verifies the session with the backend before rendering anything.
 * The platform console stays online-first: approvals, roles, payments, SMS credits and settings are
 * server-authoritative. Offline, a superadmin who signed in on this device before sees only a clearly
 * labelled, read-only cached cooperative directory.
 * Redirects use window.location (not router.replace) so they can never fire before the App Router is
 * initialised, which caused the "Router action dispatched before initialization" error.
 */
export default function SuperadminLayout({ children }: { children: ReactNode }) {
  useActiveRefresh(); // keeps the 15-minute token alive while the admin is active
  const [state, setState] = useState<GuardState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void bootSession(['SUPER_ADMIN']).then((boot) => {
      if (cancelled) return;
      if (boot.mode === 'login' || boot.mode === 'blocked') return window.location.replace(loginUrl(window.location.pathname));
      if (boot.mode === 'wrong-role') return window.location.replace(homeFor(boot.role));
      if (boot.mode === 'unreachable') return setState({ status: 'unreachable' });
      if (boot.mode === 'offline') return setState({ status: 'cached', session: boot.session });
      setState({ status: 'ok', email: boot.me.email, userId: boot.offline?.userId ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'unreachable') {
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

  if (state.status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F7F4] text-sm text-[#5E6B64]">
        Checking your access…
      </div>
    );
  }

  if (state.status === 'cached') {
    return (
      <OfflineProvider userId={state.session.userId}>
        <SuperadminOffline session={state.session} />
      </OfflineProvider>
    );
  }

  return (
    <ToastProvider>
      <OfflineProvider userId={state.userId}>
        <SuperadminDataProvider>
          <AdminShell email={state.email}>{children}</AdminShell>
        </SuperadminDataProvider>
      </OfflineProvider>
    </ToastProvider>
  );
}
