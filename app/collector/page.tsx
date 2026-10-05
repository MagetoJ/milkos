'use client';

import Link from 'next/link';
import { FileClock, Plus } from 'lucide-react';
import { loadDraft, todayStats, listBatches, type Batch } from '@/lib/collections/batch-client';
import { formatKg } from '@/lib/collections/allocation';
import { hasUserDb } from '@/lib/offline/db';
import { greeting } from '@/lib/format';
import { useLocalQuery } from '@/lib/sync/hooks';
import { BatchCard } from './_components/batch-card';
import { useCollector } from './_components/collector-context';
import { Card, SectionTitle } from './_components/ui';

export default function CollectorHome() {
  const { name } = useCollector();
  const stats = useLocalQuery(() => todayStats(), ['batches', 'queue']);
  const recent = useLocalQuery(() => listBatches({ page_size: 5 }).catch(() => ({ items: [] as Batch[], total: 0 })), ['batches']);
  const draft = useLocalQuery(() => (hasUserDb() ? loadDraft() : Promise.resolve(null)), ['batches']);
  const s = stats.data;
  const unfinished = draft.data && draft.data.status !== 'CONFIRMED' && (draft.data.weight || draft.data.lines.length) ? draft.data : null;

  return (
    <div>
      <p className="text-sm text-[#5E6B64]">{greeting()}{name ? `, ${name.split(' ')[0]}` : ''}</p>
      <h1 className="text-2xl font-bold">Today’s collections</h1>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[
          ['Milk', s ? formatKg(s.kg) : '–'],
          ['Collections', s ? String(s.batches) : '–'],
          ['Farmers', s ? String(s.farmers) : '–'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[#DDE3DE] bg-white px-3 py-3 text-center">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#5E6B64]">{label}</dt>
            <dd className="mt-1 text-base font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {s && s.pending > 0 && (
        <p className="mt-2 text-sm font-semibold text-[#8A5A0B]">{s.pending} collection{s.pending === 1 ? '' : 's'} waiting to sync</p>
      )}

      <Link
        href="/collector/new"
        className="mt-5 flex min-h-20 w-full items-center justify-center gap-3 rounded-3xl bg-[#176044] text-xl font-bold text-white shadow-sm active:bg-[#124D37]"
      >
        <Plus aria-hidden className="size-7" /> New Collection
      </Link>

      {unfinished && (
        <Link href="/collector/new" className="mt-3 block">
          <Card className="flex items-center gap-3 border-[#F1D9A6] bg-[#FBF1DC]">
            <FileClock aria-hidden className="size-6 shrink-0 text-[#8A5A0B]" />
            <span className="text-sm">
              <span className="block font-bold">Unfinished collection</span>
              {unfinished.cooler?.name ?? 'No cooler yet'}
              {unfinished.weight ? ` · ${formatKg(unfinished.weight.kg)}` : ''} · {unfinished.lines.length} farmer{unfinished.lines.length === 1 ? '' : 's'}. Tap to continue.
            </span>
          </Card>
        </Link>
      )}

      <SectionTitle action={<Link href="/collector/collections" className="min-h-11 py-3 text-sm font-semibold text-[#176044]">See all</Link>}>
        Recent
      </SectionTitle>
      {recent.data?.items.length ? (
        <ul className="space-y-2">{recent.data.items.map((b) => <li key={b.id}><BatchCard batch={b} /></li>)}</ul>
      ) : (
        <p className="text-sm text-[#5E6B64]">No collections yet. Start one with “New Collection”.</p>
      )}
    </div>
  );
}
