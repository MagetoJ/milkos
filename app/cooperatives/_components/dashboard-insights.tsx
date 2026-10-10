'use client';

// Dashboard figures and charts from the server (absent offline). Uses the admin BarChart (one hue per chart;
// the heading names the series) and simple proportional bars for per-cooler comparison.
import { useState } from 'react';
import Link from 'next/link';
import { BarChart } from '@/components/admin/bar-chart';
import { formatKes, formatNumber } from '@/lib/format';
import { getTrends, type TrendRange } from '../_api/finance-client';
import type { DashboardCharts, DashboardKpis } from '../_types/coop-types';

const RANGE_CHOICES: { value: TrendRange; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '3m', label: '3 months' },
  { value: 'custom', label: 'Custom' },
];

const kg = (n: number) => `${formatNumber(Math.round(n * 10) / 10)} KG`;
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

function Tile({ label, value, note, href, tone }: { label: string; value: string; note?: string; href?: string; tone?: 'warn' | 'bad' }) {
  const body = (
    <>
      <dt className="text-sm text-[#5E6B64]">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${tone === 'bad' ? 'text-[#B42318]' : tone === 'warn' ? 'text-[#9A5B00]' : ''}`}>{value}</dd>
      {note && <dd className="text-xs text-[#8A968F]">{note}</dd>}
    </>
  );
  return href ? (
    <Link href={href} className="block px-5 py-4 hover:bg-[#F6F7F4] focus-visible:bg-[#F6F7F4]">{body}</Link>
  ) : (
    <div className="px-5 py-4">{body}</div>
  );
}

export function DashboardKpiGrid({ kpis: k }: { kpis: DashboardKpis }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-[#EEF1EC] overflow-hidden rounded-xl border border-[#DDE3DE] bg-white md:grid-cols-4">
      <Tile label="Milk collected today" value={kg(k.milk_kg_today)} note={`${formatNumber(k.collections_today)} collections`} href="/collections" />
      <Tile label="Milk this month" value={kg(k.milk_kg_month)} note="Accepted milk" />
      <Tile label="Active farmers (30 days)" value={formatNumber(k.active_farmers_30d)} note="Delivered milk" href="/cooperatives/farmers" />
      <Tile label="Active collectors" value={formatNumber(k.active_collectors)} note={`${formatNumber(k.collectors_today)} collected today`} />
      <Tile label="Active coolers" value={formatNumber(k.active_coolers)} note={`${formatNumber(k.coolers_online)} online`} href="/cooperatives/coolers" />
      <Tile
        label="SMS balance"
        value={formatNumber(k.sms_available)}
        note={k.sms_reserved ? `${formatNumber(k.sms_reserved)} reserved for sending` : 'Available credits'}
        href="/cooperatives/sms-credits"
        tone={k.sms_available === 0 ? 'bad' : k.sms_available < 100 ? 'warn' : undefined}
      />
      <Tile
        label="SMS success (30 days)"
        value={k.sms_success_rate_30d == null ? '–' : `${k.sms_success_rate_30d}%`}
        note={`${formatNumber(k.sms_sent_30d)} sent · ${formatNumber(k.sms_failed_30d)} failed`}
        tone={k.sms_success_rate_30d != null && k.sms_success_rate_30d < 90 ? 'warn' : undefined}
      />
      <Tile label="Cooler alerts (24 h)" value={formatNumber(k.cooler_alerts_24h)} href="/cooperatives/notifications" tone={k.cooler_alerts_24h ? 'warn' : undefined} />
      <Tile label="Pending corrections" value={formatNumber(k.pending_corrections)} href="/cooperatives/corrections" tone={k.pending_corrections ? 'warn' : undefined} />
      <Tile label="Pending payments" value={formatNumber(k.pending_payments)} note={k.pending_payments ? formatKes(k.pending_payments_amount) : undefined} href="/cooperatives/payments" />
    </dl>
  );
}

/** Period picker for the trend charts (Today / 7 days / 30 days / 3 months / Custom). */
function useTrendRange(initial: DashboardCharts['trend']) {
  const [range, setRange] = useState<TrendRange | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [trend, setTrend] = useState(initial);
  const [label, setLabel] = useState('14 days');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(next: TrendRange, f = from, t = to) {
    setRange(next);
    setError('');
    if (next === 'custom' && (!f || !t)) return;
    setBusy(true);
    try {
      const res = await getTrends(next, next === 'custom' ? f : undefined, next === 'custom' ? t : undefined);
      setTrend(res.trend);
      setLabel(next === 'custom' ? `${f} to ${t}` : RANGE_CHOICES.find((c) => c.value === next)?.label.toLowerCase() ?? next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this period.');
    } finally {
      setBusy(false);
    }
  }
  return { range, from, to, setFrom, setTo, trend, label, error, busy, load };
}

export function DashboardCharts({ charts }: { charts: DashboardCharts }) {
  const t = useTrendRange(charts.trend);
  const maxCooler = Math.max(...charts.coolers.map((c) => c.kg_30d), 1);
  const smsSent = t.trend.reduce((s, d) => s + d.sms_sent, 0);
  const smsFailed = t.trend.reduce((s, d) => s + d.sms_failed, 0);
  charts = { ...charts, trend: t.trend };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-wrap items-end gap-2 lg:col-span-2" role="group" aria-label="Trend period">
        {RANGE_CHOICES.map((c) => (
          <button key={c.value} onClick={() => void t.load(c.value)} aria-pressed={t.range === c.value}
            className={`min-h-9 rounded-full border px-3 text-sm ${t.range === c.value ? 'border-mo-brand bg-mo-brand-soft font-semibold text-mo-brand' : 'border-mo-line bg-white text-mo-muted hover:bg-mo-hover'}`}>
            {c.label}
          </button>
        ))}
        {t.range === 'custom' && (
          <span className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-mo-muted">From <input type="date" value={t.from} onChange={(e) => t.setFrom(e.target.value)} className="ml-1 rounded-md border border-mo-line-strong px-2 py-1 text-sm" /></label>
            <label className="text-sm text-mo-muted">To <input type="date" value={t.to} onChange={(e) => t.setTo(e.target.value)} className="ml-1 rounded-md border border-mo-line-strong px-2 py-1 text-sm" /></label>
            <button onClick={() => void t.load('custom', t.from, t.to)} disabled={!t.from || !t.to} className="min-h-9 rounded-md bg-mo-brand px-3 text-sm font-medium text-white disabled:opacity-60">Show</button>
          </span>
        )}
        {t.busy && <span role="status" className="text-sm text-mo-muted">Loading…</span>}
        {t.error && <span role="alert" className="text-sm text-mo-danger">{t.error}</span>}
      </div>
      <section className="rounded-xl border border-[#DDE3DE] bg-white p-5" aria-labelledby="trend-title">
        <h2 id="trend-title" className="mb-4 text-base font-semibold">Collection trend · accepted KG per day ({t.label})</h2>
        <BarChart ariaLabel="Accepted milk per day" format={kg} data={charts.trend.map((d) => ({ label: day(d.date), title: day(d.date), value: d.kg }))} />
      </section>
      <section className="rounded-xl border border-[#DDE3DE] bg-white p-5" aria-labelledby="farmers-title">
        <h2 id="farmers-title" className="mb-4 text-base font-semibold">Farmer activity · farmers delivering per day</h2>
        <BarChart ariaLabel="Farmers delivering per day" format={(n) => `${formatNumber(n)} farmers`} data={charts.trend.map((d) => ({ label: day(d.date), title: day(d.date), value: d.farmers }))} />
      </section>
      <section className="rounded-xl border border-[#DDE3DE] bg-white p-5" aria-labelledby="cooler-title">
        <h2 id="cooler-title" className="mb-4 text-base font-semibold">Cooler performance · KG received (30 days)</h2>
        {charts.coolers.length === 0 ? (
          <p className="text-sm text-[#5E6B64]">No active coolers.</p>
        ) : (
          <ul className="space-y-3">
            {charts.coolers.map((c) => (
              <li key={c.id}>
                <div className="flex justify-between text-sm"><span className="font-medium">{c.name} <span className="text-xs text-[#8A968F]">{c.code}</span></span><span className="tabular-nums">{kg(c.kg_30d)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-[#EEF1EC]" aria-hidden>
                  <div className="h-2 rounded-full bg-[#2E8B62]" style={{ width: `${(c.kg_30d / maxCooler) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-[#DDE3DE] bg-white p-5" aria-labelledby="sms-title">
        <h2 id="sms-title" className="mb-1 text-base font-semibold">SMS health · sent per day</h2>
        <p className="mb-4 text-xs text-[#5E6B64]">{formatNumber(smsSent)} sent (provider accepted) · {formatNumber(smsFailed)} failed in 14 days</p>
        <BarChart ariaLabel="SMS sent per day" format={(n) => `${formatNumber(n)} SMS`} data={charts.trend.map((d) => ({ label: day(d.date), title: `${day(d.date)} (${d.sms_failed} failed)`, value: d.sms_sent }))} />
      </section>
      {charts.top_farmers.length > 0 && (
        <section className="rounded-xl border border-[#DDE3DE] bg-white p-5 lg:col-span-2" aria-labelledby="top-title">
          <h2 id="top-title" className="mb-3 text-base font-semibold">Top farmers · accepted KG (30 days)</h2>
          <ol className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {charts.top_farmers.map((f, i) => (
              <li key={f.id} className="flex justify-between gap-3 text-sm">
                <span className="truncate"><span className="text-[#8A968F]">{i + 1}.</span> {f.name} <span className="text-xs text-[#8A968F]">{f.farmer_number}</span></span>
                <span className="tabular-nums">{kg(f.kg_30d)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
