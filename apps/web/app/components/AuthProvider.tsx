'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiFetch, ApiError, setApiCooperative } from '../../lib/api';
import { getSupabase } from '../../lib/supabase/client';
import { supabaseConfigured } from '../../lib/supabase/config';

export type MeCooperative = { id: string; name: string; status: string; roles: string[]; permissions: string[] };
export type Me = {
  user: { id: string; email: string | null; phone: string | null; displayName: string; platformRole: string | null; defaultCooperativeId: string | null };
  session: { aal: 'aal1' | 'aal2'; signInMethods: string[]; mfaRequired: boolean; mfaSatisfied: boolean };
  platformPermissions: string[];
  platformTenantPermissions: string[];
  cooperatives: MeCooperative[];
};

type AuthState = {
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  me: Me | null;
  /** Set when the session is valid but the API refused it (suspended, API down, misconfigured). */
  error: string;
  cooperative: MeCooperative | null;
  cooperativeId: string | null;
  setCooperative: (id: string) => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const cooperativeStorageKey = 'milkos.active-cooperative';

/** Pages that work without a session; everything else is sent to /login. Mirrors proxy.ts. */
const PUBLIC_PATHS = ['/', '/login', '/forgot-password', '/reset-password', '/applications/status'];
export const isPublicPath = (path: string) => PUBLIC_PATHS.includes(path) || path.startsWith('/auth/');

function readStoredCooperative() {
  try { return localStorage.getItem(cooperativeStorageKey); } catch { return null; }
}

function storeCooperative(id: string) {
  try { localStorage.setItem(cooperativeStorageKey, id); } catch { /* per-device convenience only */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [cooperativeId, setCooperativeId] = useState<string | null>(null);

  const applyCooperative = useCallback((id: string | null) => {
    setCooperativeId(id);
    setApiCooperative(id);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const profile = await apiFetch<Me>('/auth/me');
      setMe(profile);
      setError('');
      const ids = profile.cooperatives.map((c) => c.id);
      const stored = readStoredCooperative();
      // Platform staff may act in cooperatives they are not members of; the API re-checks every request.
      const allowed = (id: string | null) => Boolean(id && (ids.includes(id) || profile.user.platformRole));
      const preferred = [stored, profile.user.defaultCooperativeId].find(allowed);
      applyCooperative(preferred || ids[0] || null);
    } catch (cause) {
      setMe(null);
      applyCooperative(null);
      setError(cause instanceof ApiError ? cause.message : 'The API could not be reached. Check that it is running.');
    }
  }, [applyCooperative]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setStatus('signed-out');
      setError('Supabase is not configured for the web app.');
      return;
    }
    const auth = getSupabase().auth;
    let lastToken: string | undefined;

    auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        lastToken = data.session.access_token;
        await loadMe();
        setStatus('signed-in');
      } else {
        setStatus('signed-out');
      }
    });

    const { data: listener } = auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) {
        lastToken = undefined;
        setMe(null);
        applyCooperative(null);
        setStatus('signed-out');
        return;
      }
      // Reload the profile when the session identity or assurance level changes, not on every token refresh.
      if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        if (next.access_token !== lastToken) {
          lastToken = next.access_token;
          // Supabase warns against awaiting other auth calls inside this callback.
          setTimeout(() => { void loadMe().then(() => setStatus('signed-in')); }, 0);
        }
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [applyCooperative, loadMe]);

  // Privileged roles must step up to an authenticator code before the API will serve them.
  useEffect(() => {
    const toMfa = () => { if (pathname !== '/mfa') router.push(`/mfa?next=${encodeURIComponent(pathname)}`); };
    window.addEventListener('milkos:mfa-required', toMfa);
    if (me && !me.session.mfaSatisfied && !isPublicPath(pathname)) toMfa();
    return () => window.removeEventListener('milkos:mfa-required', toMfa);
  }, [me, pathname, router]);

  const setCooperative = useCallback(async (id: string) => {
    applyCooperative(id);
    storeCooperative(id);
    try {
      await apiFetch('/auth/me/default-cooperative', { method: 'PUT', body: JSON.stringify({ cooperativeId: id }) });
    } catch { /* the local choice still applies to this device */ }
  }, [applyCooperative]);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  const value = useMemo<AuthState>(() => {
    const cooperative = me?.cooperatives.find((c) => c.id === cooperativeId) || null;
    const can = (permission: string) => {
      if (!me) return false;
      if (me.platformPermissions.includes(permission)) return true;
      if (cooperative?.permissions.includes(permission)) return true;
      return Boolean(cooperativeId && me.platformTenantPermissions.includes(permission));
    };
    return { status, session, me, error, cooperative, cooperativeId, setCooperative, can, refresh: loadMe, signOut };
  }, [status, session, me, error, cooperativeId, setCooperative, loadMe, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Shown in place of a page that needs an active cooperative when the user has none selected. */
export function NoCooperative() {
  const { me } = useAuth();
  const hasPlatformRole = Boolean(me?.user.platformRole);
  return (
    <main className="landing">
      <div className="formcard">
        <div className="eyebrow">NO COOPERATIVE SELECTED</div>
        <h1>{hasPlatformRole ? 'Choose a cooperative' : 'You are not in a cooperative yet'}</h1>
        <p>
          {hasPlatformRole
            ? 'Platform staff act inside a cooperative by choosing it from the menu at the top of the page.'
            : 'Ask your cooperative manager to invite you, or register a new cooperative and wait for approval.'}
        </p>
        {!hasPlatformRole && <div className="actions"><a href="/cooperatives/register">Register cooperative</a><a className="secondary" href="/applications/status">Track application</a></div>}
      </div>
    </main>
  );
}
