// A collection as a mobile card: when, where, how much, how many farmers, and its sync / SMS state in words.
import Link from 'next/link';
import { ChevronRight, Keyboard } from 'lucide-react';
import { StatusBadge } from '@/components/admin';
import { SyncPill } from '@/components/offline/status';
import { formatKg } from '@/lib/collections/allocation';
import type { Batch } from '@/lib/collections/batch-client';
import { receiptSummary } from '@/lib/collections/receipts';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'grey'> = {
  CONFIRMED: 'green', CORRECTION_PENDING: 'amber', REVERSAL_PENDING: 'amber', CORRECTED: 'grey', REVERSED: 'red',
};

export function BatchCard({ batch }: { batch: Batch }) {
  const pending = batch.sync_status && batch.sync_status !== 'synced';
  return (
    <Link
      href={`/collector/collections?id=${encodeURIComponent(batch.id)}`}
      className="flex items-center gap-3 rounded-2xl border border-[#DDE3DE] bg-white p-4 active:bg-[#F6F7F4]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold tabular-nums">{formatKg(batch.allocated_weight_kg)}</span>
          {pending ? <SyncPill status={batch.sync_status} error={batch.sync_error} /> : <StatusBadge status={batch.status} tone={STATUS_TONE[batch.status]} />}
          {batch.weight_source === 'MANUAL' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FBF1DC] px-2 py-0.5 text-xs font-semibold text-[#8A5A0B]">
              <Keyboard aria-hidden className="size-3" /> Manual
            </span>
          )}
          {batch.weight_source === 'SIMULATED' && <StatusBadge status="SIMULATED" label="Simulated" tone="blue" />}
        </div>
        <p className="truncate text-sm text-[#3C4A43]">
          {batch.farmer_count} farmer{batch.farmer_count === 1 ? '' : 's'} · {batch.cooler_name ?? 'No cooler'}
        </p>
        <p className="truncate text-xs text-[#5E6B64]">
          {batch.reference === 'Pending sync' ? 'Reference after sync' : batch.reference} · {batch.collection_date} {batch.collection_time ?? ''}
        </p>
        <p className="truncate text-xs text-[#5E6B64]">{receiptSummary(batch.lines.map((l) => l.receipt_status), batch.sync_status)}</p>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-[#8A968F]" />
    </Link>
  );
}
