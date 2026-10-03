'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ErrorBanner, FilterBar, FilterDate, FilterSelect, LoadingState, StatCard } from '@/components/admin';
import { BarChart } from '@/components/admin/bar-chart';
import { formatLitres, formatNumber, formatPercent, isoDay } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { collectionsReport } from '../../_api/superadmin-client';
import { useCooperativeOptions } from './common';

const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export function ReportsView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDay() });
  const [coop, setCoop] = useState(cooperativeId ?? '');
  const coops = useCooperativeOptions(!cooperativeId);
  const report = useResource(
    () => collectionsReport({ date_from: range.from, date_to: range.to, cooperative_id: coop }),
    [range.from, range.to, coop],
  );
  const r = report.data;

  return (
    <>
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-[#5E6B64]">Milk volume and quality across the platform, by day, cooperative and farmer.</p>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-[#DDE3DE] bg-white px-4 py-3">
        <FilterBar>
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              onClick={() => setRange({ from: daysAgo(n - 1), to: isoDay() })}
              className={`rounded-full px-3 py-1 text-sm ${range.from === daysAgo(n - 1) && range.to === isoDay() ? 'bg-[#176044] text-white' : 'bg-[#EEF1EC] text-[#394640] hover:bg-[#E3E8E4]'}`}
            >
              {n} days
            </button>
          ))}
          <FilterDate label="From" value={range.from} onChange={(v) => setRange({ ...range, from: v })} />
          <FilterDate label="To" value={range.to} onChange={(v) => setRange({ ...range, to: v })} />
          {!cooperativeId && <FilterSelect label="Cooperative" value={coop} onChange={setCoop} allLabel="All cooperatives" options={coops} />}
        </FilterBar>
      </div>

      {report.error && <ErrorBanner message={report.error} onRetry={report.reload} />}
      {!r && !report.error && <LoadingState />}
      {r && (
        <div className={`space-y-6 ${report.loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Accepted milk" value={formatLitres(r.totals.accepted_litres)} hint={`${formatLitres(r.totals.average_daily_litres)} per day on average`} />
            <StatCard label="Collections" value={formatNumber(r.totals.collections)} hint={`${formatNumber(r.totals.farmers_delivering)} farmers delivering`} />
            <StatCard
              label="Rejected"
              value={formatLitres(r.totals.rejected_litres)}
              hint={`${formatNumber(r.totals.rejected_collections)} collections`}
              tone={r.totals.rejected_collections > 0 ? 'warning' : 'default'}
            />
            <StatCard label="Average quality" value={formatPercent(r.totals.average_fat_percentage)} hint={`butterfat · SNF ${formatPercent(r.totals.average_snf_percentage)}`} />
          </div>

          <section className="rounded-xl border border-[#DDE3DE] bg-white px-5 py-4">
            <h2 className="text-base font-semibold">Accepted milk per day</h2>
            <p className="mb-4 text-sm text-[#5E6B64]">Litres · {r.range.days} days</p>
            <BarChart
              ariaLabel="Accepted litres per day"
              data={r.daily.map((d) => ({ label: shortDay(d.date), title: `${shortDay(d.date)} · ${formatNumber(d.collections)} collections`, value: d.accepted_litres }))}
              format={formatLitres}
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-[#DDE3DE] bg-white">
              <h2 className="px-5 pb-2 pt-4 text-base font-semibold">By cooperative</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-y border-[#EEF1EC] text-left text-xs uppercase tracking-wide text-[#8A968F]">
                    <tr>
                      <th className="px-5 py-2 font-medium">Cooperative</th>
                      <th className="px-3 py-2 text-right font-medium">Accepted</th>
                      <th className="px-3 py-2 text-right font-medium">Rejected</th>
                      <th className="px-3 py-2 text-right font-medium">Farmers</th>
                      <th className="px-5 py-2 text-right font-medium">Fat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EC]">
                    {r.by_cooperative.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-6 text-center text-[#5E6B64]">No collections in this period.</td></tr>
                    )}
                    {r.by_cooperative.map((c) => (
                      <tr key={c.id}>
                        <td className="px-5 py-2.5"><Link href={`/superadmin/cooperatives/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatLitres(c.accepted_litres)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatLitres(c.rejected_litres)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(c.farmers_delivering)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatPercent(c.average_fat_percentage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-xl border border-[#DDE3DE] bg-white">
              <h2 className="px-5 pb-2 pt-4 text-base font-semibold">Top farmers</h2>
              <ol className="divide-y divide-[#EEF1EC] border-t border-[#EEF1EC]">
                {r.top_farmers.length === 0 && <li className="px-5 py-6 text-center text-sm text-[#5E6B64]">No collections in this period.</li>}
                {r.top_farmers.map((f, i) => (
                  <li key={f.id}>
                    <Link href={`/superadmin/farmers?focus=${f.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-[#F6F7F4]">
                      <span className="w-5 text-xs tabular-nums text-[#8A968F]">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.full_name}</span>
                        <span className="block truncate text-xs text-[#8A968F]">{f.farmer_number} · {f.cooperative_name}</span>
                      </span>
                      <span className="tabular-nums">{formatLitres(f.accepted_litres)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <details className="rounded-xl border border-[#DDE3DE] bg-white">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Daily figures as a table</summary>
            <div className="max-h-96 overflow-auto border-t border-[#EEF1EC]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-[#8A968F]">
                  <tr>
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Accepted</th>
                    <th className="px-3 py-2 text-right font-medium">Rejected</th>
                    <th className="px-5 py-2 text-right font-medium">Collections</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EC]">
                  {r.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="px-5 py-1.5">{shortDay(d.date)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatLitres(d.accepted_litres)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatLitres(d.rejected_litres)}</td>
                      <td className="px-5 py-1.5 text-right tabular-nums">{formatNumber(d.collections)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
