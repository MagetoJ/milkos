'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Notice } from '@/components/settings/settings-ui';
import { getMyCollection, type FarmerCollectionDetail } from '@/lib/farmer/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatKes, humanize } from '@/lib/format';
import { QUALITY_LABEL, RECEIPT_LABEL, RECORD_LABEL, kg } from '../../_components/farmer-ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-sm text-mo-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{value ?? '–'}</dd>
    </div>
  );
}

export default function FarmerCollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<FarmerCollectionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getMyCollection(id).then(setC, (e) => setError(e instanceof ApiError ? e.message : 'Could not load this delivery.'));
  }, [id]);

  return (
    <div>
      <Link href="/farmer/collections" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-mo-brand"><ChevronLeft aria-hidden className="size-4" />Deliveries</Link>
      {error && <Notice tone="danger">{error}</Notice>}
      {c && (
        <>
          <h1 className="text-3xl font-bold tabular-nums">{kg(c.quantity_kg)}</h1>
          <p className="text-sm text-mo-muted">{formatDate(c.date)}{c.time ? ` at ${c.time}` : ''} · Ref <span className="font-mono">{c.reference}</span></p>
          {c.record_status !== 'ACTIVE' && (
            <div className="mt-3">
              <Notice tone="warn">
                This delivery was {RECORD_LABEL[c.record_status].toLowerCase()} by the cooperative and no longer counts.
                {c.replaced_by_collection_id && <> <Link className="font-semibold underline" href={`/farmer/collections/${c.replaced_by_collection_id}`}>See the corrected delivery</Link>.</>}
              </Notice>
            </div>
          )}
          {c.batch_status === 'CORRECTION_PENDING' && <div className="mt-3"><Notice tone="info">A correction to this delivery is being reviewed by the cooperative.</Notice></div>}
          {c.batch_status === 'REVERSAL_PENDING' && <div className="mt-3"><Notice tone="info">A reversal of this delivery is being reviewed by the cooperative.</Notice></div>}

          <dl className="mt-4 divide-y divide-mo-line rounded-2xl border border-mo-line bg-white px-4">
            <Row label="Centre" value={c.centre_name} />
            <Row label="Cooler" value={c.cooler_name} />
            <Row label="Collector" value={c.collector_name} />
            <Row label="Weight" value={kg(c.quantity_kg)} />
            <Row label="Litres" value={c.quantity_litres != null ? `${c.quantity_litres.toFixed(2)} L` : null} />
            <Row label="How it was weighed" value={c.weight_source ? (c.weight_source === 'MANUAL' ? 'Typed in by the collector' : c.weight_source === 'SCALE' ? 'Scale' : humanize(c.weight_source)) : null} />
            <Row label="Quality" value={<>{QUALITY_LABEL[c.quality_status]}{c.rejection_reason ? <span className="block text-mo-danger">{c.rejection_reason}</span> : null}</>} />
            {c.fat_percentage != null && <Row label="Butterfat" value={`${c.fat_percentage}%`} />}
            <Row label={c.price_is_estimate ? 'Milk price (current)' : 'Milk price (paid)'} value={c.price_per_kg != null ? `${formatKes(c.price_per_kg)} / KG` : 'Not set yet'} />
            <Row label={c.price_is_estimate ? 'Amount (estimate)' : 'Amount'} value={c.amount != null ? formatKes(c.amount) : '–'} />
            <Row label="Payment" value={c.payment ? `${humanize(c.payment.status)} · ${c.payment.reference}` : 'Not paid yet'} />
            <Row label="Receipt" value={c.receipt_status ? (RECEIPT_LABEL[c.receipt_status] ?? humanize(c.receipt_status)) : 'No SMS receipt'} />
            <Row label="Collection batch" value={c.batch_reference ? <span className="font-mono">{c.batch_reference}</span> : null} />
          </dl>
          <p className="mt-3 text-sm text-mo-muted">Something wrong with this delivery? Ask your cooperative to correct it: delivery records can&apos;t be changed in the app.</p>
        </>
      )}
    </div>
  );
}
