'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { FarmerCollection } from '@/lib/farmer/api';
import { formatDate, formatKes } from '@/lib/format';

export const QUALITY_LABEL: Record<string, string> = { ACCEPTED: 'Accepted', REJECTED: 'Rejected', PENDING: 'Awaiting quality result' };
export const RECORD_LABEL: Record<string, string> = { ACTIVE: '', SUPERSEDED: 'Corrected (replaced)', REVERSED: 'Reversed' };
export const RECEIPT_LABEL: Record<string, string> = {
  SENT: 'SMS receipt sent', DELIVERED: 'SMS receipt delivered', PENDING: 'SMS receipt queued', PENDING_PROVIDER: 'SMS receipt waiting',
  FAILED: 'SMS receipt failed', REFUNDED: 'SMS receipt failed', SKIPPED: 'No SMS receipt', RESERVED: 'SMS receipt sending', SENDING: 'SMS receipt sending',
};

export function kg(value: number | null | undefined): string {
  return `${(value ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
}

export function CollectionRow({ c }: { c: FarmerCollection }) {
  const struck = c.record_status !== 'ACTIVE';
  return (
    <li>
      <Link href={`/farmer/collections/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-mo-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mo-brand/40">
        <span className="min-w-0">
          <span className={`block font-semibold tabular-nums ${struck ? 'text-mo-subtle line-through' : ''}`}>{kg(c.quantity_kg)}</span>
          <span className="block text-sm text-mo-muted">
            {formatDate(c.date)}{c.time ? ` · ${c.time}` : ''}{c.centre_name ? ` · ${c.centre_name}` : ''}
          </span>
          {(c.quality_status !== 'ACCEPTED' || struck) && (
            <span className={`block text-sm ${c.quality_status === 'REJECTED' || struck ? 'text-mo-danger' : 'text-mo-warn'}`}>
              {struck ? RECORD_LABEL[c.record_status] : QUALITY_LABEL[c.quality_status]}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-right">
          <span>
            {c.amount != null && <span className="block font-semibold tabular-nums">{formatKes(c.amount)}</span>}
            {c.amount != null && c.price_is_estimate && <span className="block text-xs text-mo-subtle">estimate</span>}
          </span>
          <ChevronRight aria-hidden className="size-4 text-mo-subtle" />
        </span>
      </Link>
    </li>
  );
}
