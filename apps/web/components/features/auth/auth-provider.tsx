'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api/client';
import { getActiveCooperativeId, setActiveCooperativeId } from '@/lib/auth/active-cooperative';
import { AUTH_FLOW_PATHS } from '@/lib/auth/redirect';
import type { Me, MeCooperative, Permission } from '@/lib/auth/types';

type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: SessionStatus;
  me: Me | undefined;
  meLoading: boolean;
  meError: Error | null;
  activeCooperative: MeCooperative | null;
  /** Platform staff may act in a cooperative they are not a member of. */
  activeCooperativeId: string | null;
  setActiveCooperative: (id: string) => void;
  can: (permission: Permission) => boolean;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [activeCooperativeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setStatus(data.session ? 'authenticated' : 'anonymous'));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setStatus(session ? 'authenticated' : 'anonymous');
      if (event === 'SIGNED_OUT') {
        setActiveCooperativeId(null);
        setActiveId(null);
        queryClient.clear();
      } else if (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        // New identity or assurance level: roles/permissions/MFA state may have changed.
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, queryClient]);

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<Me>('/auth/me', { cooperativeId: null }),
    enabled: status === 'authenticated',
    staleTime: 60_000,
    retry: 1,
  });
  const me = meQuery.data;

  // Pick the working cooperative: this browser's last choice, else the server default, else the only one.
  useEffect(() => {
    if (!me) return;
    const allowed = (id: string | null) => Boolean(id) && (me.cooperatives.some((c) => c.id === id) || me.user.platformRole !== null);
    const stored = getActiveCooperativeId();
    const chosen = [stored, me.user.defaultCooperativeId, me.cooperatives.length === 1 ? me.cooperatives[0].id : null].find(allowed) || null;
    setActiveCooperativeId(chosen);
    setActiveId(chosen);
  }, [me]);

  // MFA step-up: privileged roles cannot use the app on an aal1 session.
  useEffect(() => {
    if (me && me.session.mfaRequired && !me.session.mfaSatisfied && !AUTH_FLOW_PATHS.includes(pathname)) {
      router.replace(`/auth/mfa?next=${encodeURIComponent(pathname)}`);
    }
  }, [me, pathname, router]);

  const setActiveCooperative = useCallback((id: string) => {
    setActiveCooperativeId(id);
    setActiveId(id);
    // Everything cached belongs to the previous tenant.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
    apiFetch('/auth/me/default-cooperative', { method: 'PUT', body: JSON.stringify({ cooperativeId: id }), cooperativeId: null }).catch(() => undefined);
  }, [queryClient]);

  const activeCooperative = me?.cooperatives.find((c) => c.id === activeCooperativeId) || null;

  const can = useCallback((permission: Permission) => {
    if (!me) return false;
    if (permission.startsWith('platform:')) return me.platformPermissions.includes(permission);
    if (!activeCooperativeId) return false;
    const tenantPermissions = activeCooperative?.permissions || me.platformTenantPermissions;
    return tenantPermissions.includes(permission);
  }, [me, activeCooperative, activeCooperativeId]);

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    await supabase.auth.signOut({ scope });
    router.replace('/login');
    router.refresh();
  }, [supabase, router]);

  const value: AuthContextValue = {
    status,
    me,
    meLoading: status === 'loading' || (status === 'authenticated' && meQuery.isPending),
    meError: meQuery.error,
    activeCooperative,
    activeCooperativeId,
    setActiveCooperative,
    can,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
