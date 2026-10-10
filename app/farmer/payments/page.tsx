'use client';

import { useEffect, useState } from 'react';
import { Notice } from '@/components/settings/settings-ui';
import { getPriceHistory, listMyPayments, type FarmerPaymentRow } from '@/lib/farmer/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatKes, humanize } from '@/lib/format';
import { kg } from '../_components/farmer-ui';

export default function FarmerPaymentsPage() {
  const [rows, setRows] = useState<FarmerPaymentRow[] | null>(null);
  const [prices, setPrices] = useState<{ price_per_kg: number; effective_from: string; effective_to: string | null }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyPayments().then(setRows, (e) => setError(e instanceof ApiError ? e.message : 'Could not load your payments.'));
    getPriceHistory().then(setPrices, () => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-mo-muted">What your cooperative has paid, or is preparing to pay, for your milk.</p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {rows && rows.length === 0 && <p className="text-sm text-mo-muted">No payments yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-mo-line rounded-2xl border border-mo-line bg-white">
          {rows.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold tabular-nums">{formatKes(p.net_amount)}</span>
                <span className={`text-sm font-medium ${p.status === 'PAID' ? 'text-mo-brand' : p.status === 'FAILED' ? 'text-mo-danger' : 'text-mo-warn'}`}>{humanize(p.status)}</span>
              </div>
              <p className="text-sm text-mo-muted">{formatDate(p.period_start)} – {formatDate(p.period_end)} · {kg(p.total_kg)}{p.average_price_per_kg ? ` at ${formatKes(p.average_price_per_kg)}/KG` : ''}</p>
              {p.adjustments_amount !== 0 && <p className="text-sm text-mo-muted">Includes adjustments of {formatKes(p.adjustments_amount)} (corrections to earlier milk)</p>}
              {p.paid_at && <p className="text-sm text-mo-muted">Paid {formatDate(p.paid_at)} · Ref <span className="font-mono">{p.reference}</span></p>}
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="prices-heading">
        <h2 id="prices-heading" className="mb-2 text-base font-semibold">Milk price history</h2>
        {prices.length ? (
          <table className="w-full rounded-2xl border border-mo-line bg-white text-sm">
            <caption className="sr-only">Milk prices per KG over time</caption>
            <thead><tr className="text-left text-mo-muted"><th scope="col" className="px-4 py-2 font-medium">From</th><th scope="col" className="px-4 py-2 font-medium">To</th><th scope="col" className="px-4 py-2 text-right font-medium">Per KG</th></tr></thead>
            <tbody className="divide-y divide-mo-line">
              {prices.map((p) => (
                <tr key={p.effective_from}><td className="px-4 py-2">{formatDate(p.effective_from)}</td><td className="px-4 py-2">{p.effective_to ? formatDate(p.effective_to) : 'Now'}</td><td className="px-4 py-2 text-right tabular-nums">{formatKes(p.price_per_kg)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-mo-muted">Your cooperative hasn&apos;t published a price yet.</p>}
      </section>
    </div>
  );
}
