'use client';

import Link from 'next/link';
import {
  Building2,
  ClipboardList,
  Droplets,
  Milk,
  RefreshCw,
  Smartphone,
  Snowflake,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { StatCard } from '@/components/admin';
import { BarChart } from '@/components/admin/bar-chart';
import { formatKes, formatLitres, formatNumber, greeting } from '@/lib/format';
import { useSuperadminData } from './superadmin-data';
import { DecisionQueue } from './decision-queue';
import { ActivityFeed } from './activity-feed';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export function SuperadminDashboard() {
  const { dashboard: d, queue, status, refreshing, errors, lastUpdated, refresh } = useSuperadminData();
  const waiting = queue.length;
  const loading = status === 'loading' || !d;
  const v = (n: number | undefined, fmt = formatNumber) => (loading ? '–' : fmt(n ?? 0));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}.</h1>
          <p className="mt-1 text-[#5E6B64]">
            {status === 'loading'
              ? 'Loading the platform…'
              : waiting === 0
                ? 'All caught up. Nothing needs your decision.'
                : `${waiting} ${waiting === 1 ? 'item needs' : 'items need'} your decision.`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#5E6B64]">
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>}
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

      <section aria-label="Milk collected" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-[#DDE3DE] bg-white px-5 py-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Accepted milk, last 14 days</h2>
              <p className="text-sm text-[#5E6B64]">All cooperatives · litres per day</p>
            </div>
            <Link href="/superadmin/reports" className="text-sm font-medium text-[#176044] hover:underline">
              Reports
            </Link>
          </div>
          {d ? (
            <BarChart
              ariaLabel="Accepted litres per day for the last 14 days"
              data={d.milk.daily.map((p) => ({ label: dayLabel(p.date), title: dayLabel(p.date), value: p.litres }))}
              format={formatLitres}
            />
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-[#F3F5F2]" />
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard label="Milk today" icon={Milk} value={v(d?.milk.today, formatLitres)} hint={loading ? undefined : `${formatNumber(d?.milk.collections_today)} collections`} href="/superadmin/collections" />
          <StatCard label="Last 7 days" icon={Droplets} value={v(d?.milk.week, formatLitres)} />
          <StatCard label="Last 30 days" icon={Droplets} value={v(d?.milk.month, formatLitres)} />
        </div>
      </section>

      <section aria-label="Platform totals" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Cooperatives"
          icon={Building2}
          value={v(d?.cooperatives.total)}
          hint={loading ? undefined : `${formatNumber(d?.cooperatives.active)} active · ${formatNumber(d?.cooperatives.suspended)} suspended`}
          tone={d && d.cooperatives.suspended > 0 ? 'warning' : 'default'}
          href="/superadmin/cooperatives"
        />
        <StatCard label="Users" icon={UserCog} value={v(d?.users.total)} hint={loading ? undefined : `${formatNumber(d?.users.active)} active accounts`} href="/superadmin/users" />
        <StatCard label="Farmers" icon={Users} value={v(d?.farmers.total)} hint={loading ? undefined : `${formatNumber(d?.farmers.active)} active`} href="/superadmin/farmers" />
        <StatCard label="Collectors" icon={Truck} value={v(d?.collectors.total)} hint={loading ? undefined : `${formatNumber(d?.collectors.active)} active`} href="/superadmin/collectors" />
        <StatCard label="Managers" icon={UserCog} value={v(d?.users.managers)} hint={loading ? undefined : `${formatNumber(d?.users.coop_admins)} cooperative admins`} href="/superadmin/users?role=MANAGER" />
        <StatCard
          label="Coolers"
          icon={Snowflake}
          value={v(d?.coolers.total)}
          hint={loading ? undefined : `${formatNumber(d?.coolers.operational)} operational · ${formatNumber(d?.coolers.offline)} offline`}
          tone={d && d.coolers.offline > 0 ? 'warning' : 'default'}
          href="/superadmin/coolers"
        />
        <StatCard
          label="Waiting for review"
          icon={ClipboardList}
          value={v((d?.pending.applications ?? 0) + (d?.pending.payments ?? 0))}
          hint={loading ? undefined : `${formatNumber(d?.pending.applications)} applications · ${formatNumber(d?.pending.payments)} payments`}
          tone={d && d.pending.applications + d.pending.payments > 0 ? 'warning' : 'good'}
          href="/superadmin/onboarding"
        />
        <StatCard
          label="SMS credits"
          icon={Smartphone}
          value={v(d?.sms.total_balance)}
          hint={
            loading
              ? undefined
              : d!.sms.low_balance_cooperatives > 0
                ? `${formatNumber(d!.sms.low_balance_cooperatives)} cooperatives running low`
                : `${formatKes(d!.pending.payment_amount_kes)} in top-ups pending`
          }
          tone={d && d.sms.low_balance_cooperatives > 0 ? 'warning' : 'default'}
          href="/superadmin/payments"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <DecisionQueue title="Needs a decision" limit={8} />

        <div className="space-y-6">
          <section aria-labelledby="top-title" className="rounded-xl border border-[#DDE3DE] bg-white">
            <h2 id="top-title" className="px-5 pb-2 pt-5 text-base font-semibold">Top cooperatives, 30 days</h2>
            {d && d.top_cooperatives.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-[#5E6B64]">No collections recorded yet.</p>
            ) : (
              <ol className="divide-y divide-[#EEF1EC]">
                {(d?.top_cooperatives ?? []).map((c, i) => (
                  <li key={c.id}>
                    <Link href={`/superadmin/cooperatives/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-[#F6F7F4]">
                      <span className="w-4 text-xs tabular-nums text-[#8A968F]">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      <span className="tabular-nums text-[#5E6B64]">{formatLitres(c.litres_30d)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="activity-title" className="rounded-xl border border-[#DDE3DE] bg-white">
            <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
              <h2 id="activity-title" className="text-base font-semibold">Recent activity</h2>
              <Link href="/superadmin/audit" className="text-sm font-medium text-[#176044] hover:underline">
                Audit log
              </Link>
            </div>
            <ActivityFeed limit={6} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default SuperadminDashboard;
