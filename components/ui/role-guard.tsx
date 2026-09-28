'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, getSession, homeFor, loginUrl, logout, type UserRole } from '@/lib/auth';

type GuardState = 'checking' | 'authorized' | 'unavailable';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

/**
 * Client-side route guard used by each dashboard's layout.tsx.
 *  - no/expired token          -> /login?next=<this page>
 *  - valid token, wrong role   -> that role's own dashboard (never a login loop)
 *  - backend rejects token     -> clear it, /login
 *  - backend unreachable       -> "retry" screen, token kept
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>('checking');
  const [email, setEmail] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const session = getSession();
      if (!session) return router.replace(loginUrl(pathname));
      if (!allowedRoles.includes(session.role)) return router.replace(homeFor(session.role));

      // Authoritative check: signature, account still active, role unchanged in the DB.
      try {
        const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${session.token}` } });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          clearSession();
          return router.replace(loginUrl(pathname));
        }
        if (!res.ok) return setState('unavailable');

        const me = (await res.json()) as { role?: UserRole; email?: string };
        if (cancelled) return;
        if (!me.role || !allowedRoles.includes(me.role)) {
          // Role changed server-side since the token was issued: force a fresh login.
          clearSession();
          return router.replace(loginUrl());
        }
        setEmail(me.email);
        setState('authorized');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [allowedRoles, pathname, router]);

  if (state === 'unavailable') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-slate-600">
        <p>Cannot reach the Milkflow API to verify your session.</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state !== 'authorized') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm font-medium">
        Verifying your session...
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
        {email && <span>{email}</span>}
        <button onClick={logout} className="font-semibold text-emerald-800 hover:underline">
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}