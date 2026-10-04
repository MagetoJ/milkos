'use client';

import { CloudOff } from 'lucide-react';
import { ConnectionStatus } from '@/components/offline/status';
import { listAll } from '@/lib/offline/repositories';
import { useLocalQuery } from '@/lib/sync/hooks';
import type { OfflineSessionRecord } from '@/lib/offline/types';
import { formatNumber } from '@/lib/format';

interface CachedCooperative {
  id: string;
  name: string;
  code: string;
  county: string;
  status: string;
  sms_credit_balance: number;
}

/** Read-only, clearly labelled cached view for platform staff while the server is unreachable. */
export function SuperadminOffline({ session }: { session: OfflineSessionRecord }) {
  const coops = useLocalQuery(() => listAll<CachedCooperative>('cooperative', (a, b) => String(a.name).localeCompare(String(b.name))), ['cooperative']);
  return (
    <main className="min-h-screen bg-[#F6F7F4] px-4 py-8 text-[#17221D] sm:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#5E6B64]">Milkflow platform · cached</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Working offline</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#5E6B64]">
              The platform console needs a live connection: approvals, roles, payments, SMS credits and settings are only changed on the
              server. Below is the cooperative directory as this device last saw it.
            </p>
          </div>
          <ConnectionStatus />
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-[#DDE3DE] bg-white px-4 py-3 text-sm">
          <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-[#5E6B64]" />
          <p>
            Signed in as {session.user.email}. Cached data, read-only. This page reconnects automatically;{' '}
            <button className="font-medium text-[#176044] hover:underline" onClick={() => window.location.reload()}>
              reload
            </button>{' '}
            once you are online.
          </p>
        </div>
        <section className="rounded-xl border border-[#DDE3DE] bg-white">
          <h2 className="px-5 pb-2 pt-5 text-base font-semibold">Cooperatives (cached)</h2>
          {(coops.data ?? []).length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[#5E6B64]">No cached cooperatives on this device yet.</p>
          ) : (
            <ul className="divide-y divide-[#EEF1EC]">
              {(coops.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{c.name}</span> <span className="text-[#8A968F]">{c.code} · {c.county}</span>
                  </span>
                  <span className="text-xs text-[#5E6B64]">
                    {c.status} · {formatNumber(c.sms_credit_balance)} SMS credits
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
