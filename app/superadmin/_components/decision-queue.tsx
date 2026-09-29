'use client';

import { useMemo, useState } from 'react';
import { Building2, Inbox, Search, Smartphone } from 'lucide-react';
import type { QueueFilter, QueueItem } from '../_types/superadmin-types';
import { waitingFor, waitTone, type WaitTone } from '../_lib/format';
import { useSuperadminData } from './superadmin-data';
import { ReviewPanel } from './review-panel';

const TONE: Record<WaitTone, string> = {
  fresh: 'text-[#5E6B64]',
  due: 'bg-[#FBF1DC] text-[#8A5A0B]',
  overdue: 'bg-[#FDECEA] text-[#B42318]',
};

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'application', label: 'Onboarding' },
  { value: 'payment', label: 'SMS credits' },
];

const EMPTY_COPY: Record<QueueFilter, string> = {
  all: 'Nothing is waiting for a decision. New applications and top-ups will appear here.',
  application: 'No cooperative applications are waiting for review.',
  payment: 'No M-Pesa top-ups are waiting for verification.',
};

interface Props {
  title: string;
  description?: string;
  /** Fix the queue to one kind (used on the dedicated pages). */
  kind?: QueueItem['kind'];
  limit?: number;
}

export function DecisionQueue({ title, description, kind, limit }: Props) {
  const { queue, status } = useSuperadminData();
  const [filter, setFilter] = useState<QueueFilter>(kind ?? 'all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<QueueItem | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return queue.filter(
      (item) =>
        (filter === 'all' || item.kind === filter) &&
        (!q || `${item.title} ${item.subtitle}`.toLowerCase().includes(q)),
    );
  }, [queue, filter, query]);

  const shown = limit ? visible.slice(0, limit) : visible;
  const overdue = visible.filter((i) => waitTone(i.submittedAt) === 'overdue').length;

  return (
    <section aria-labelledby="queue-title" className="rounded-xl border border-[#DDE3DE] bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          <h2 id="queue-title" className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-[#5E6B64]">
            {description ?? 'Oldest first.'}
            {overdue > 0 && <span className="text-[#B42318]"> {overdue} waiting over 3 days.</span>}
          </p>
        </div>
        <label className="relative w-full sm:w-56">
          <span className="sr-only">Search queue</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#8A968F]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or place"
            className="h-9 w-full rounded-lg border border-[#C9D2CB] pl-8 pr-3 text-sm outline-none focus:border-[#176044] focus:ring-2 focus:ring-[#176044]/20"
          />
        </label>
      </div>

      {!kind && (
        <div role="tablist" aria-label="Filter queue" className="flex gap-1 border-b border-[#EEF1EC] px-5">
          {FILTERS.map((f) => {
            const count = f.value === 'all' ? queue.length : queue.filter((i) => i.kind === f.value).length;
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.value)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  active ? 'border-[#176044] font-medium text-[#17221D]' : 'border-transparent text-[#5E6B64] hover:text-[#17221D]'
                }`}
              >
                {f.label} <span className="tabular-nums text-[#8A968F]">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {status === 'loading' ? (
        <ul aria-busy="true" className="divide-y divide-[#EEF1EC]">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="size-9 animate-pulse rounded-lg bg-[#EEF1EC]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-[#EEF1EC]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#F3F5F2]" />
              </div>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <Inbox className="size-8 text-[#B8C4BC]" />
          <p className="mt-3 max-w-xs text-sm text-[#5E6B64]">
            {query ? `No matches for “${query}”.` : EMPTY_COPY[filter]}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#EEF1EC]">
          {shown.map((item) => {
            const tone = waitTone(item.submittedAt);
            const Icon = item.kind === 'application' ? Building2 : Smartphone;
            return (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  onClick={() => setSelected(item)}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left outline-none transition-colors hover:bg-[#F6F7F4] focus-visible:bg-[#F6F7F4] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#176044]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#E7F0EA] text-[#176044]">
                    <Icon className="size-4" />
                    <span className="sr-only">{item.kind === 'application' ? 'Application' : 'SMS top-up'}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-[#5E6B64]">{item.subtitle}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums ${TONE[tone]}`}>
                    {waitingFor(item.submittedAt)}
                  </span>
                  <span className="hidden shrink-0 text-sm font-medium text-[#176044] sm:inline">Review</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {limit && visible.length > limit && (
        <p className="border-t border-[#EEF1EC] px-5 py-3 text-sm text-[#5E6B64]">
          Showing the {limit} oldest of {visible.length}.
        </p>
      )}

      <ReviewPanel item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
