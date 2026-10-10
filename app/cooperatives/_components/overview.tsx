'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { ConnectionStatus, LocalDataNote, SyncPill, SyncStatus } from '@/components/offline/status';
import { formatDateTime, formatLitres } from '@/lib/format';
import { hasUserDb } from '@/lib/offline/db';
import { latestReadings, recentCollections, recentNotifications } from '@/lib/offline/repositories';
import { useLocalQuery } from '@/lib/sync/hooks';
import type { AlertNotification, Collection, CoolerReading } from '@/app/superadmin/_types/platform-types';
import { formatDate, formatNumber, formatPhone, greeting } from '../_lib/format';
import { useCoop } from './coop-context';
import { DashboardCharts, DashboardKpiGrid } from './dashboard-insights';
import { QuickActions } from './quick-actions';
import { secondaryButton } from './ui';

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'warn' }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-sm text-[#5E6B64]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {note && <dd className={`text-xs ${tone === 'warn' ? 'font-medium text-[#9A5B00]' : 'text-[#8A968F]'}`}>{note}</dd>}
    </div>
  );
}

interface Attention {
  text: string;
  href?: string;
  action?: string;
}

export function Overview() {
  const { overview, canManageTeam, refresh, offlineCapable } = useCoop();
  const { cooperative, farmers, centres, team, coolers, recent_farmers, milk } = overview;
  const local = offlineCapable && hasUserDb();
  const collections = useLocalQuery(() => (local ? recentCollections<Collection>(5) : Promise.resolve([])), ['collections'], [local]);
  const readings = useLocalQuery(() => (local ? latestReadings<CoolerReading>(5) : Promise.resolve([])), ['readings'], [local]);
  const alerts = useLocalQuery(
    async () => (local ? (await recentNotifications<AlertNotification>(20)).filter((n) => Date.now() - Date.parse(n.created_at ?? '') < 86_400_000) : []),
    ['notifications'],
    [local],
  );
  const [refreshing, setRefreshing] = useState(false);

  const credits = cooperative.sms_credit_balance;
  const attention: Attention[] = [];
  if (centres.total === 0) {
    attention.push({ text: 'Add your first collection centre.', href: '/cooperatives/centres?new=1', action: 'Add centre' });
  }
  if (farmers.total === 0) {
    attention.push({ text: 'Register your farmers so their deliveries can be recorded.', href: '/cooperatives/farmers?new=1', action: 'Add farmer' });
  } else if (farmers.unassigned > 0 && centres.active > 0) {
    attention.push({
      text: `${formatNumber(farmers.unassigned)} ${farmers.unassigned === 1 ? 'farmer isn’t' : 'farmers aren’t'} assigned to a collection centre.`,
      href: '/cooperatives/farmers?centre=none',
      action: 'Assign',
    });
  }
  if (team.collectors === 0 && canManageTeam) {
    attention.push({ text: 'Add a collector who will record milk at your centres.', href: '/cooperatives/team?new=1', action: 'Add collector' });
  }
  if (credits === 0) {
    attention.push({ text: 'You have no SMS credits, so farmers won’t receive SMS receipts or alerts.', href: '/cooperatives/sms-credits', action: 'Buy credits' });
  } else if (credits < 100) {
    attention.push({ text: `Only ${formatNumber(credits)} SMS credits left.`, href: '/cooperatives/sms-credits', action: 'Buy credits' });
  }
  const k = overview.kpis;
  if (k?.pending_corrections) {
    attention.push({ text: `${formatNumber(k.pending_corrections)} correction or reversal request${k.pending_corrections === 1 ? '' : 's'} waiting for review.`, href: '/cooperatives/corrections', action: 'Review' });
  }
  if (k?.pending_payments) {
    attention.push({ text: `${formatNumber(k.pending_payments)} farmer payment${k.pending_payments === 1 ? '' : 's'} not yet recorded as paid.`, href: '/cooperatives/payments', action: 'Open' });
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}.</h1>
          <LocalDataNote show={overview.offline} />
          <p className="mt-1 text-[#5E6B64]">
            {cooperative.name}
            <span className="text-[#8A968F]">
              {' · '}
              {cooperative.location ? `${cooperative.location}, ` : ''}
              {cooperative.county}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onRefresh} disabled={refreshing} className={secondaryButton}>
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <QuickActions role={overview.role} />

      <dl className="grid grid-cols-2 divide-[#EEF1EC] rounded-xl border border-[#DDE3DE] bg-white md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-[#EEF1EC] md:[&>*:nth-child(-n+2)]:border-b-0">
        <Metric
          label="Active farmers"
          value={formatNumber(farmers.active)}
          note={farmers.total > farmers.active ? `${formatNumber(farmers.total - farmers.active)} inactive` : undefined}
        />
        <Metric
          label="Collection centres"
          value={formatNumber(centres.active)}
          note={
            centres.with_cooler > 0
              ? `${formatNumber(centres.with_cooler)} with a cooler`
              : coolers.total > 0
                ? `${formatNumber(coolers.operational)} of ${formatNumber(coolers.total)} coolers working`
                : undefined
          }
        />
        <Metric
          label="Team"
          value={formatNumber(team.admins + team.managers + team.collectors)}
          note={`${formatNumber(team.managers)} ${team.managers === 1 ? 'manager' : 'managers'} · ${formatNumber(team.collectors)} ${team.collectors === 1 ? 'collector' : 'collectors'}`}
        />
        <Metric
          label="SMS credits"
          value={formatNumber(credits)}
          note={credits === 0 ? 'None left' : credits < 100 ? 'Running low' : undefined}
          tone={credits < 100 ? 'warn' : undefined}
        />
      </dl>

      <dl className="grid grid-cols-2 divide-[#EEF1EC] rounded-xl border border-[#DDE3DE] bg-white md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-[#EEF1EC] md:[&>*:nth-child(-n+2)]:border-b-0">
        <Metric label="Milk today" value={formatLitres(milk.today)} note={`${formatNumber(milk.collections_today)} collections`} />
        <Metric label="Milk this month" value={formatLitres(milk.month)} note={overview.offline ? 'From this device’s recent history' : undefined} />
        <Metric label="Coolers" value={formatNumber(coolers.total)} note={`${formatNumber(coolers.operational)} operational`} />
        <Metric
          label="Cooler alerts (24 h)"
          value={local ? formatNumber(alerts.data?.length ?? 0) : '–'}
          note={local && (alerts.data?.length ?? 0) > 0 ? 'See Cooler monitoring' : undefined}
          tone={(alerts.data?.length ?? 0) > 0 ? 'warn' : undefined}
        />
      </dl>

      {overview.kpis && <DashboardKpiGrid kpis={overview.kpis} />}
      {overview.charts && <DashboardCharts charts={overview.charts} />}

      <section aria-label="Connection and synchronization" className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#DDE3DE] bg-white px-5 py-4">
        <ConnectionStatus />
        {offlineCapable ? <SyncStatus /> : <p className="text-xs text-[#8A968F]">This device isn&apos;t set up for offline use.</p>}
        {offlineCapable && (
          <Link href="/cooperatives/sync" className="text-sm font-medium text-[#176044] hover:underline">
            Sync center
          </Link>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="attention-title" className="self-start rounded-xl border border-[#DDE3DE] bg-white">
          <h2 id="attention-title" className="px-5 pb-2 pt-5 text-base font-semibold">
            Needs attention
          </h2>
          {attention.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[#5E6B64]">All set up. Nothing needs your attention right now.</p>
          ) : (
            <ul className="divide-y divide-[#EEF1EC]">
              {attention.map((item) => (
                <li key={item.text} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                  <span>{item.text}</span>
                  {item.href && (
                    <Link href={item.href} className="inline-flex shrink-0 items-center gap-1 font-medium text-[#176044] hover:underline">
                      {item.action}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-title" className="self-start rounded-xl border border-[#DDE3DE] bg-white">
          <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
            <h2 id="recent-title" className="text-base font-semibold">
              Recently added farmers
            </h2>
            <Link href="/cooperatives/farmers" className="text-sm font-medium text-[#176044] hover:underline">
              View all
            </Link>
          </div>
          {recent_farmers.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[#5E6B64]">No farmers yet.</p>
          ) : (
            <ul className="divide-y divide-[#EEF1EC]">
              {recent_farmers.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.full_name}</span>
                    <span className="text-xs text-[#8A968F]">
                      {f.farmer_number} · {formatPhone(f.phone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[#8A968F]">{formatDate(f.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {local && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="recent-collections" className="self-start rounded-xl border border-[#DDE3DE] bg-white">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
              <h2 id="recent-collections" className="text-base font-semibold">Recent collections</h2>
              <Link href="/collections" className="text-sm font-medium text-[#176044] hover:underline">View all</Link>
            </div>
            {(collections.data ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-sm text-[#5E6B64]">No collections recorded recently.</p>
            ) : (
              <ul className="divide-y divide-[#EEF1EC]">
                {(collections.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.farmer_name}</span>
                      <span className="text-xs text-[#8A968F]">{formatDate(c.collection_date)} {c.collection_time ?? ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <SyncPill status={c.sync_status} />
                      <span className="tabular-nums">{formatLitres(c.quantity_litres)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="recent-readings" className="self-start rounded-xl border border-[#DDE3DE] bg-white">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
              <h2 id="recent-readings" className="text-base font-semibold">Recent cooler readings</h2>
              <Link href="/cooperatives/coolers" className="text-sm font-medium text-[#176044] hover:underline">Monitor coolers</Link>
            </div>
            {(readings.data ?? []).length === 0 ? (
              <p className="px-5 pb-5 text-sm text-[#5E6B64]">No cooler readings on this device yet.</p>
            ) : (
              <ul className="divide-y divide-[#EEF1EC]">
                {(readings.data ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="text-xs text-[#8A968F]">{formatDateTime(r.measured_at)}{r.source === 'SIMULATED' ? ' · simulated' : ''}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <SyncPill status={r.sync_status} />
                      <span className="tabular-nums">{r.volume_litres == null ? '–' : formatLitres(r.volume_litres)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}