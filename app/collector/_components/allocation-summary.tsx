// Total / Allocated / Remaining with the allocation state in words and icon as well as colour:
//   green  all of the weight is allocated
//   amber  some weight remains unallocated (blocks confirmation: everything must be allocated)
//   red    more is allocated than was weighed (blocks confirmation)
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import type { AllocationSummary } from '@/lib/collections/allocation';
import { formatWeight } from './scale-display';

const STATE = {
  valid: { box: 'border-[#9CCFB3] bg-[#E3F1E9]', text: 'text-[#176044]', label: 'All weight allocated', Icon: CheckCircle2 },
  remaining: { box: 'border-[#F1D9A6] bg-[#FBF1DC]', text: 'text-[#8A5A0B]', label: 'Allocate the remaining weight to confirm', Icon: AlertTriangle },
  over: { box: 'border-[#F4C7C3] bg-[#FDECEA]', text: 'text-[#B42318]', label: 'Allocated more than the total weight', Icon: AlertOctagon },
  empty: { box: 'border-[#DDE3DE] bg-white', text: 'text-[#5E6B64]', label: 'No weight allocated yet', Icon: CircleDashed },
} as const;

export function AllocationSummaryCard({ summary }: { summary: AllocationSummary }) {
  const s = STATE[summary.state];
  const remaining = summary.remainingCents / 100;
  return (
    <section aria-label="Allocation summary" data-state={summary.state} className={`rounded-2xl border p-4 ${s.box}`}>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#5E6B64]">Total</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums">{formatWeight(summary.totalCents / 100)} KG</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#5E6B64]">Allocated</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums">{formatWeight(summary.allocatedCents / 100)} KG</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#5E6B64]">{remaining < 0 ? 'Over by' : 'Remaining'}</dt>
          <dd className={`mt-0.5 text-lg font-bold tabular-nums ${s.text}`}>{formatWeight(Math.abs(remaining))} KG</dd>
        </div>
      </dl>
      <p className={`mt-3 flex items-center justify-center gap-1.5 text-sm font-semibold ${s.text}`} role="status" aria-live="polite">
        <s.Icon aria-hidden className="size-4" /> {s.label}
      </p>
    </section>
  );
}
