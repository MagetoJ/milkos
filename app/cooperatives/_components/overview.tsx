'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { formatDate, formatNumber, formatPhone, greeting } from '../_lib/format';
import { useCoop } from './coop-context';
import { primaryButton, secondaryButton } from './ui';

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
  const { overview, canManageTeam, refresh } = useCoop();
  const { cooperative, farmers, centres, team, coolers, recent_farmers } = overview;
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
    attention.push({ text: 'You have no SMS credits, so farmers won’t receive notifications. Contact the platform administrator to top up.' });
  } else if (credits < 100) {
    attention.push({ text: `Only ${formatNumber(credits)} SMS credits left. Ask the platform administrator to top up soon.` });
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
          <Link href="/cooperatives/farmers?new=1" className={primaryButton}>
            <Plus className="size-4" />
            Add farmer
          </Link>
        </div>
      </header>

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
    </div>
  );
}