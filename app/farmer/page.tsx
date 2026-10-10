'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Notice } from '@/components/settings/settings-ui';
import { getDashboard, type FarmerDashboard, type Range } from '@/lib/farmer/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatKes, greeting, humanize } from '@/lib/format';
import { CollectionRow, kg } from './_components/farmer-ui';

const RANGES: { value: Exclude<Range, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '3m', label: '3 months' },
];

export default function FarmerHome() {
  const [range, setRange] = useState<Exclude<Range, 'custom'>>('7d');
  const [data, setData] = useState<FarmerDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    getDashboard(range).then((d) => !cancelled && setData(d), (e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load your deliveries.'));
    return () => { cancelled = true; };
  }, [range]);

  const max = Math.max(1, ...(data?.daily.map((d) => d.kg) ?? [1]));
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-mo-muted">{greeting()}{data ? `, ${data.farmer.name.split(' ')[0]}` : ''}</p>
        <h1 className="text-2xl font-bold">Your milk</h1>
        {data && <p className="text-sm text-mo-muted">{data.farmer.cooperative_name} · Member {data.farmer.farmer_number}</p>}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="grid grid-cols-2 gap-2">
        <section aria-label="Today's milk" className="rounded-2xl border border-mo-line bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mo-muted">Today&apos;s milk</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{data ? kg(data.today.kg) : '–'}</p>
          <p className="text-sm text-mo-muted">{data ? `${data.today.deliveries} deliver${data.today.deliveries === 1 ? 'y' : 'ies'}` : ''}</p>
        </section>
        <section aria-label="This month" className="rounded-2xl border border-mo-line bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mo-muted">This month</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{data ? kg(data.this_month.kg) : '–'}</p>
          <p className="text-sm text-mo-muted">{data ? `${data.this_month.deliveries} deliver${data.this_month.deliveries === 1 ? 'y' : 'ies'}` : ''}</p>
        </section>
      </div>

      <div role="group" aria-label="Period" className="flex gap-2 overflow-x-auto">
        {RANGES.map((r) => (
          <button key={r.value} onClick={() => setRange(r.value)} aria-pressed={range === r.value}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${range === r.value ? 'border-mo-brand bg-mo-brand text-white' : 'border-mo-line bg-white text-mo-ink'}`}>
            {r.label}
          </button>
        ))}
      </div>

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-mo-line bg-white p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-mo-muted">Milk delivered</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">{kg(data.totals.kg)}</dd>
              <dd className="text-xs text-mo-muted">{data.totals.deliveries} deliveries{data.totals.rejected ? ` · ${data.totals.rejected} rejected` : ''}</dd>
            </div>
            <div className="rounded-2xl border border-mo-line bg-white p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-mo-muted">Earnings</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums">{formatKes(data.totals.earnings)}</dd>
              <dd className="text-xs text-mo-muted">
                Estimate at your cooperative&apos;s prices{data.totals.unpriced_deliveries ? ` · ${data.totals.unpriced_deliveries} without a price yet` : ''}
              </dd>
            </div>
          </dl>

          {data.daily.length > 1 && (
            <section aria-label="Milk per day" className="rounded-2xl border border-mo-line bg-white p-4">
              <p className="mb-3 text-sm font-semibold">Milk per day</p>
              <ol className="flex h-28 items-end gap-1">
                {data.daily.map((d) => (
                  <li key={d.date} className="flex flex-1 flex-col items-center justify-end" title={`${formatDate(d.date)}: ${kg(d.kg)}`}>
                    <span className="w-full rounded-t bg-mo-brand" style={{ height: `${Math.max(4, (d.kg / max) * 100)}%` }} />
                    <span className="sr-only">{formatDate(d.date)}: {kg(d.kg)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section aria-label="Payment status" className="rounded-2xl border border-mo-line bg-white p-4">
            <p className="text-sm font-semibold">Latest payment</p>
            {data.last_payment ? (
              <p className="mt-1 text-sm">
                <span className="font-semibold tabular-nums">{formatKes(data.last_payment.net_amount)}</span> for {formatDate(data.last_payment.period_start)} – {formatDate(data.last_payment.period_end)}
                <span className="block text-mo-muted">{humanize(data.last_payment.status)}{data.last_payment.paid_at ? ` on ${formatDate(data.last_payment.paid_at)}` : ''}</span>
              </p>
            ) : <p className="mt-1 text-sm text-mo-muted">No payments yet.</p>}
            <Link href="/farmer/payments" className="mt-2 inline-block text-sm font-medium text-mo-brand underline-offset-2 hover:underline">All payments</Link>
          </section>

          {data.unread_notifications > 0 && (
            <p className="flex items-center gap-2 text-sm text-mo-info"><Bell aria-hidden className="size-4" />{data.unread_notifications} new message{data.unread_notifications === 1 ? '' : 's'} from your cooperative</p>
          )}

          <section aria-labelledby="recent-heading">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="recent-heading" className="text-base font-semibold">Recent collections</h2>
              <Link href="/farmer/collections" className="text-sm font-medium text-mo-brand">See all</Link>
            </div>
            {data.recent.length ? (
              <ul className="divide-y divide-mo-line rounded-2xl border border-mo-line bg-white">{data.recent.map((c) => <CollectionRow key={c.id} c={c} />)}</ul>
            ) : <p className="text-sm text-mo-muted">No deliveries recorded yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}
