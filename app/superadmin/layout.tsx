'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AdminShell } from './_components/admin-shell';
import { SuperadminDataProvider } from './_components/superadmin-data';
import { ToastProvider } from './_components/toast';
import { authHeaders } from './_api/superadmin-client';

type GuardState = { status: 'checking' } | { status: 'offline' } | { status: 'ok'; email?: string };

/**
 * Verifies the session with the backend before rendering anything.
 * Redirects use window.location (not router.replace) so they can never fire
 * before the App Router is initialised, which caused the
 * "Router action dispatched before initialization" error.
 */
export default function SuperadminLayout({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GuardState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store', headers: authHeaders() })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('milkflow_token');
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        if (!res.ok) return setState({ status: 'offline' });

        const me = (await res.json()) as { role?: string; email?: string };
        if (me.role !== 'SUPER_ADMIN') {
          window.location.replace('/'); // `/` forwards each role to its own dashboard
          return;
        }
        setState({ status: 'ok', email: me.email });
      })
      .catch(() => !cancelled && setState({ status: 'offline' }));

    return () => {
      cancelled = true;
    };
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

  if (state.status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F7F4] text-sm text-[#5E6B64]">
        Checking your access…
      </div>
    );
  }

  return (
    <ToastProvider>
      <SuperadminDataProvider>
        <AdminShell email={state.email}>{children}</AdminShell>
      </SuperadminDataProvider>
    </ToastProvider>
  );
}
