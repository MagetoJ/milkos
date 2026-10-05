'use client';

// The collector's collections: a card list, and one collection in detail (?id=...). Detail works offline
// from this phone's copy; corrections and reversals need a connection (another person reviews them).
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Search } from 'lucide-react';
import { StatusBadge } from '@/components/admin';
import { SyncPill } from '@/components/offline/status';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatKg } from '@/lib/collections/allocation';
import {
  getBatch, listBatches, requestCorrection, requestReversal, type Batch, type BatchDetail,
} from '@/lib/collections/batch-client';
import { receiptLabel } from '@/lib/collections/receipts';
import { ApiError } from '@/lib/api-client';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useIsOnline, useLocalQuery } from '@/lib/sync/hooks';
import { BatchCard } from '../_components/batch-card';
import { bigInput, Button, Card, Notice, SectionTitle } from '../_components/ui';

export default function CollectorCollectionsPage() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Collections />
    </Suspense>
  );
}

function Collections() {
  const params = useSearchParams();
  const id = params.get('id');
  return id ? <Detail id={id} /> : <List />;
}

function List() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const page = useLocalQuery(() => listBatches({ search, page_size: 50 }), ['batches'], [search]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Collections</h1>
      <div className="relative mt-3">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#8A968F]" />
        <label htmlFor="collection-search" className="sr-only">Search collections</label>
        <input id="collection-search" type="search" className={`${bigInput} pl-12`} placeholder="Reference, farmer or cooler" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {page.error && <div className="mt-3"><Notice tone="red">{page.error}</Notice></div>}
      <ul className="mt-3 space-y-2" aria-busy={!page.data}>
        {page.data?.items.map((b) => <li key={b.id}><BatchCard batch={b} /></li>)}
      </ul>
      {page.data && page.data.items.length === 0 && <p className="mt-6 text-center text-sm text-[#5E6B64]">No collections found.</p>}
      {page.data?.offline && <p className="mt-4 text-center text-xs text-[#8A968F]">Showing the collections saved on this phone (recent history).</p>}
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const online = useIsOnline();
  const toast = useToast();
  const batch = useLocalQuery(() => getBatch(id, { online }), ['batches'], [id, online]);
  const [mode, setMode] = useState<'none' | 'correct' | 'reverse'>('none');
  const b = batch.data as (BatchDetail & Batch) | null;

  return (
    <div>
      <Link href="/collector/collections" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#176044]">
        <ArrowLeft aria-hidden className="size-4" /> All collections
      </Link>
      {!batch.data && !batch.error && <p role="status" className="py-10 text-center text-[#5E6B64]">Loading…</p>}
      {batch.error && <Notice tone="red">{batch.error}</Notice>}
      {batch.data === null && <Notice>This collection isn’t on this phone.</Notice>}
      {b && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tabular-nums">{formatKg(b.captured_weight_kg)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {b.sync_status && b.sync_status !== 'synced' ? <SyncPill status={b.sync_status} error={b.sync_error} /> : <StatusBadge status={b.status} />}
              <span className="text-sm text-[#5E6B64]">{b.reference === 'Pending sync' ? 'Reference after sync' : b.reference}</span>
            </div>
          </div>
          <Card>
            <dl className="divide-y divide-[#EEF1EC] text-sm">
              {([
                ['Date', `${b.collection_date} ${b.collection_time ?? ''}`],
                ['Cooler', b.cooler_name ?? '–'],
                ['Centre', b.centre_name ?? '–'],
                ['Weight', b.weight_source === 'MANUAL' ? 'Manual entry' : b.weight_source === 'SIMULATED' ? `Simulated scale${b.scale_name ? ` (${b.scale_name})` : ''}` : b.weight_source === 'LITRES' ? 'Entered in litres' : `Scale${b.scale_name ? ` (${b.scale_name})` : ''}`],
                ['Allocated', formatKg(b.allocated_weight_kg)],
                ['Remaining', formatKg(b.remaining_weight_kg)],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-[#5E6B64]">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <section aria-label="Farmers">
            <SectionTitle>Farmers ({b.lines.length})</SectionTitle>
            <ul className="divide-y divide-[#EEF1EC] rounded-2xl border border-[#DDE3DE] bg-white">
              {b.lines.map((l) => {
                const r = receiptLabel(l.receipt_status, b.sync_status ?? 'synced', b.send_receipts);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.farmer_name}</span>
                      <span className="text-xs text-[#5E6B64]">{l.farmer_number}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono font-bold tabular-nums">{formatKg(l.quantity_kg)}</span>
                      <span title={r.detail}><StatusBadge status={r.label} label={r.label} tone={r.tone} /></span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {b.pending_request && <Notice tone="amber">A {b.pending_request.type.toLowerCase()} of this collection is waiting for review.</Notice>}
          {'requests' in b && b.requests?.length > 0 && (
            <section aria-label="Requests">
              <SectionTitle>Correction history</SectionTitle>
              <ul className="space-y-2">
                {b.requests.map((r) => (
                  <li key={r.id} className="rounded-xl border border-[#DDE3DE] bg-white p-3 text-sm">
                    <p className="font-semibold">{r.request_type === 'CORRECTION' ? 'Correction' : 'Reversal'} · <StatusBadge status={r.status} /></p>
                    <p className="text-[#3C4A43]">{r.reason}</p>
                    {r.review_comment && <p className="text-xs text-[#5E6B64]">Reviewer: {r.review_comment}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {b.status === 'CONFIRMED' && (!b.sync_status || b.sync_status === 'synced') && (
            <section aria-label="Changes" className="space-y-2">
              <SectionTitle>Something wrong?</SectionTitle>
              {!online && <Notice>Corrections need a connection: another person must review them.</Notice>}
              <p className="text-xs text-[#5E6B64]">A confirmed collection is never edited. Ask for a correction or a reversal; it is applied only after someone else approves it.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="medium" disabled={!online} onClick={() => setMode('correct')}>Request correction</Button>
                <Button variant="medium" disabled={!online} onClick={() => setMode('reverse')}>Request reversal</Button>
              </div>
            </section>
          )}
          {mode !== 'none' && (
            <RequestForm
              batch={b}
              mode={mode}
              onClose={() => setMode('none')}
              onDone={(message) => {
                setMode('none');
                toast(message);
                batch.reload();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RequestForm({ batch, mode, onClose, onDone }: { batch: Batch; mode: 'correct' | 'reverse'; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(String(batch.captured_weight_kg));
  const [amounts, setAmounts] = useState<Record<string, string>>(Object.fromEntries(batch.lines.map((l) => [l.farmer_id, String(l.quantity_kg)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reverse') {
        await requestReversal(batch.id, reason.trim());
        onDone('Reversal requested. An administrator will review it.');
      } else {
        await requestCorrection(batch.id, reason.trim(), {
          captured_weight_kg: Number(total),
          allocations: batch.lines.map((l) => ({ farmer_id: l.farmer_id, quantity_kg: Number(amounts[l.farmer_id]) })).filter((a) => a.quantity_kg > 0),
        });
        onDone('Correction requested. Someone else will review it.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 border-[#176044]">
      <h2 className="text-lg font-bold">{mode === 'reverse' ? 'Request reversal' : 'Request correction'}</h2>
      {mode === 'correct' && (
        <>
          <div>
            <label htmlFor="corr-total" className="mb-1 block text-sm font-bold">Correct total weight (KG)</label>
            <input id="corr-total" inputMode="decimal" className={bigInput} value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
          {batch.lines.map((l) => (
            <div key={l.farmer_id}>
              <label htmlFor={`corr-${l.farmer_id}`} className="mb-1 block text-sm font-bold">{l.farmer_name} (KG; 0 removes)</label>
              <input id={`corr-${l.farmer_id}`} inputMode="decimal" className={bigInput} value={amounts[l.farmer_id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [l.farmer_id]: e.target.value })} />
            </div>
          ))}
        </>
      )}
      <div>
        <label htmlFor="req-reason" className="mb-1 block text-sm font-bold">Why? (required)</label>
        <textarea id="req-reason" rows={3} className={bigInput} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="medium" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="medium" className="!border-[#176044] !bg-[#176044] !text-white" onClick={() => void submit()} disabled={busy || reason.trim().length < 5}>
          {busy ? 'Sending…' : 'Send request'}
        </Button>
      </div>
    </Card>
  );
}
