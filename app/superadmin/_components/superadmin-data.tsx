'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchPendingApplications,
  fetchPendingPayments,
  fetchSuperadminStats,
  processApplication,
  verifyPayment,
} from '../_api/superadmin-client';
import type {
  CooperativeApplication,
  Decision,
  PaymentVerificationItem,
  QueueItem,
  SuperadminStats,
} from '../_types/superadmin-types';
import { formatKes, formatNumber, parseServerDate } from '../_lib/format';

const AUTO_REFRESH_MS = 60_000;

interface SuperadminData {
  stats: SuperadminStats | null;
  queue: QueueItem[];
  counts: { applications: number; payments: number };
  status: 'loading' | 'ready';
  refreshing: boolean;
  errors: string[];
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  resolve: (item: QueueItem, decision: Decision, reason?: string) => Promise<void>;
}

const Ctx = createContext<SuperadminData | null>(null);

function applicationToItem(a: CooperativeApplication): QueueItem {
  return {
    kind: 'application',
    id: a.id,
    title: a.org_name,
    subtitle: `${a.applicant_name} · ${a.location}`,
    submittedAt: a.created_at,
    data: a,
  };
}

function paymentToItem(p: PaymentVerificationItem): QueueItem {
  return {
    kind: 'payment',
    id: p.id,
    title: p.cooperative_name || `Cooperative ${p.cooperative_id?.slice(0, 8) ?? 'unknown'}`,
    subtitle: `${formatNumber(p.credits_requested)} credits for ${formatKes(p.amount_kes)}`,
    submittedAt: p.submitted_at,
    data: p,
  };
}

/** One shared source for the sidebar counts, overview and queue pages. */
export function SuperadminDataProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<SuperadminStats | null>(null);
  const [applications, setApplications] = useState<CooperativeApplication[]>([]);
  const [payments, setPayments] = useState<PaymentVerificationItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);

    const [s, a, p] = await Promise.allSettled([
      fetchSuperadminStats(),
      fetchPendingApplications(),
      fetchPendingPayments(),
    ]);
    if (s.status === 'fulfilled') setStats(s.value);
    if (a.status === 'fulfilled') setApplications(a.value);
    if (p.status === 'fulfilled') setPayments(p.value);

    setErrors(
      [s, a, p]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))),
    );
    setLastUpdated(new Date());
    setStatus('ready');
    setRefreshing(false);
    inFlight.current = false;
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const resolve = useCallback(
    async (item: QueueItem, decision: Decision, reason?: string) => {
      if (item.kind === 'application') {
        await processApplication(item.id, decision === 'approve' ? 'APPROVE' : 'REJECT', reason);
        setApplications((list) => list.filter((a) => a.id !== item.id));
      } else {
        await verifyPayment(item.id, decision === 'approve' ? 'VERIFY' : 'REJECT', reason);
        setPayments((list) => list.filter((p) => p.id !== item.id));
      }
      refresh();
    },
    [refresh],
  );

  const queue = useMemo(
    () =>
      [...applications.map(applicationToItem), ...payments.map(paymentToItem)].sort(
        (x, y) => parseServerDate(x.submittedAt).getTime() - parseServerDate(y.submittedAt).getTime(),
      ),
    [applications, payments],
  );

  const value: SuperadminData = {
    stats,
    queue,
    counts: { applications: applications.length, payments: payments.length },
    status,
    refreshing,
    errors,
    lastUpdated,
    refresh,
    resolve,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSuperadminData(): SuperadminData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSuperadminData must be used inside <SuperadminDataProvider>');
  return ctx;
}
