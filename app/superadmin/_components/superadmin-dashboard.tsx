'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useSuperadminData } from './superadmin-data';
import { DecisionQueue } from './decision-queue';
import { ActivityFeed } from './activity-feed';
import { formatNumber, greeting } from '../_lib/format';

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-sm text-[#5E6B64]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {note && <dd className="text-xs text-[#8A968F]">{note}</dd>}
    </div>
  );
}

export function SuperadminDashboard() {
  const { stats, queue, status, refreshing, errors, lastUpdated, refresh } = useSuperadminData();
  const waiting = queue.length;
  const loading = status === 'loading';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}.</h1>
          <p className="mt-1 text-[#5E6B64]">
            {loading
              ? 'Loading the platform…'
              : waiting === 0
                ? 'All caught up. Nothing needs your decision.'
                : `${waiting} ${waiting === 1 ? 'item needs' : 'items need'} your decision.`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#5E6B64]">
          {lastUpdated && (
            <span>
              Updated {lastUpdated.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9D2CB] bg-white px-3 py-1.5 text-sm font-medium text-[#17221D] hover:bg-[#EEF1EC] disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-[#F4C7C3] bg-[#FDECEA] px-4 py-3 text-sm text-[#912018]">
          Some data didn&apos;t load: {errors.join('; ')}
        </div>
      )}

      {/* One strip, not four cards: these are reference numbers, the queue is the job. */}
      <dl className="grid grid-cols-2 divide-[#EEF1EC] rounded-xl border border-[#DDE3DE] bg-white md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-[#EEF1EC] md:[&>*:nth-child(-n+2)]:border-b-0">
        <Metric label="Cooperatives" value={loading ? '–' : formatNumber(stats?.total_cooperatives)} />
        <Metric label="Farmers" value={loading ? '–' : formatNumber(stats?.total_farmers)} />
        <Metric label="Coolers" value={loading ? '–' : formatNumber(stats?.total_coolers)} />
        <Metric label="Milk collected today" value={loading ? '–' : `${formatNumber(stats?.milk_today_kg)} kg`} note="Across all cooperatives" />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DecisionQueue title="Needs a decision" limit={8} />

        <section aria-labelledby="activity-title" className="self-start rounded-xl border border-[#DDE3DE] bg-white">
          <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
            <h2 id="activity-title" className="text-base font-semibold">Recent activity</h2>
            <Link href="/superadmin/activity" className="text-sm font-medium text-[#176044] hover:underline">
              View all
            </Link>
          </div>
          <ActivityFeed limit={6} />
        </section>
      </div>
    </div>
  );
}

export default SuperadminDashboard;
