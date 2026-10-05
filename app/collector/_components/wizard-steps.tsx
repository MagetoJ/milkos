'use client';

// The six screens of a new collection. Each is a plain component driven by the draft state machine
// (lib/collections/draft.ts); the wizard (collection-wizard.tsx) owns persistence and submission.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BatteryMedium, CheckCircle2, ChevronRight, CloudOff, Gauge, Keyboard, MapPin, Plus, Scale, Search, Snowflake, Thermometer, X,
} from 'lucide-react';
import { formatKg, parseKg, summarize } from '@/lib/collections/allocation';
import { blockers, type CollectionDraft, type DraftAction } from '@/lib/collections/draft';
import { receiptSummary } from '@/lib/collections/receipts';
import type { CoolerOption, FarmerOption } from '@/lib/collections/batch-client';
import { availableScaleAdapters, hardwareScaleNote } from '@/lib/scale/registry';
import { MockScaleAdapter } from '@/lib/scale/mock-adapter';
import { roundKg } from '@/lib/scale/stability';
import { SOURCE_OF_SCALE } from '@/lib/scale/types';
import type { UseScale } from '@/lib/scale/use-scale';
import { useDebounced } from '@/lib/hooks/use-debounced';
import type { RecordSyncStatus } from '@/lib/offline/types';
import { AllocationSummaryCard } from './allocation-summary';
import { ScaleDisplay } from './scale-display';
import { bigInput, Button, Card, Notice, SectionTitle } from './ui';

type Dispatch = (action: DraftAction) => void;

// ---------------- STEP 1: cooler ----------------

export function CoolerStep({
  coolers,
  defaultCoolerId,
  draft,
  dispatch,
  loading,
}: {
  coolers: CoolerOption[];
  defaultCoolerId: string | null;
  draft: CollectionDraft;
  dispatch: Dispatch;
  loading: boolean;
}) {
  const ordered = useMemo(
    () => [...coolers].sort((a, b) => Number(b.id === defaultCoolerId) - Number(a.id === defaultCoolerId)),
    [coolers, defaultCoolerId],
  );
  if (loading) return <p role="status" className="py-10 text-center text-[#5E6B64]">Loading coolers…</p>;
  if (!coolers.length) return <Notice tone="amber">No active coolers are set up for your cooperative. Ask your cooperative admin to add one.</Notice>;
  return (
    <ul className="space-y-3" aria-label="Coolers">
      {ordered.map((c) => {
        const selected = draft.cooler?.id === c.id;
        return (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => dispatch({ type: 'select_cooler', cooler: { id: c.id, name: c.name, code: c.code, centre_id: c.centre_id, centre_name: c.centre_name } })}
              className={`flex w-full items-center gap-4 rounded-2xl border-2 bg-white p-4 text-left ${selected ? 'border-[#176044]' : 'border-[#DDE3DE]'}`}
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#E3F1E9] text-[#176044]">
                <Snowflake aria-hidden className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold">{c.name}</span>
                  {c.id === defaultCoolerId && <span className="rounded-full bg-[#E6EEF8] px-2 py-0.5 text-xs font-semibold text-[#1F4E86]">Your cooler</span>}
                </span>
                <span className="block text-sm text-[#5E6B64]">{c.code}{c.centre_name ? ` · ${c.centre_name}` : ''}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#5E6B64]">
                  <span className="inline-flex items-center gap-1">
                    <Gauge aria-hidden className="size-3.5" />
                    {c.current_volume_litres != null ? `${Math.round(c.current_volume_litres).toLocaleString()} L${c.capacity_litres ? ` of ${Math.round(c.capacity_litres).toLocaleString()} L` : ''}` : 'Level unknown'}
                  </span>
                  {c.last_temperature_c != null && (
                    <span className="inline-flex items-center gap-1"><Thermometer aria-hidden className="size-3.5" />{c.last_temperature_c}°C</span>
                  )}
                  <span>{c.is_operational ? 'Operational' : 'Reported offline'}</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-[#8A968F]" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------- STEP 2: scale ----------------

export function ScaleStep({ draft, dispatch, scale }: { draft: CollectionDraft; dispatch: Dispatch; scale: UseScale }) {
  const adapters = availableScaleAdapters();
  const note = hardwareScaleNote();
  const connected = scale.status?.state === 'connected';
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-[#5E6B64]">Cooler</p>
        <p className="text-lg font-bold">{draft.cooler?.name}</p>
        {draft.cooler?.centre_name && <p className="flex items-center gap-1 text-sm text-[#5E6B64]"><MapPin aria-hidden className="size-4" />{draft.cooler.centre_name}</p>}
      </Card>

      <section aria-label="Scale connection" className="space-y-3">
        {connected && scale.status ? (
          <Card className="border-[#9CCFB3]">
            <p className="flex items-center gap-2 font-bold text-[#176044]"><CheckCircle2 aria-hidden className="size-5" /> Connected</p>
            <p className="mt-1 text-sm">{scale.status.deviceName}</p>
            {scale.status.transport === 'SIMULATED' && (
              <p className="mt-1 text-xs font-semibold text-[#1F4E86]">Simulator: weights are made up and will be recorded as SIMULATED.</p>
            )}
            {scale.status.capabilities.battery && scale.status.batteryPercent != null && (
              <p className="mt-1 flex items-center gap-1 text-sm text-[#5E6B64]"><BatteryMedium aria-hidden className="size-4" />Battery {scale.status.batteryPercent}%</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="medium" onClick={() => void scale.disconnect()}>Disconnect</Button>
              <Button
                variant="medium"
                className="!border-[#176044] !bg-[#176044] !text-white"
                onClick={() => dispatch({
                  type: 'use_scale',
                  scale: { key: scale.definition?.key ?? 'scale', name: scale.status!.deviceName ?? 'Scale', identifier: scale.status!.deviceId, transport: scale.status!.transport },
                })}
              >
                Use this scale
              </Button>
            </div>
          </Card>
        ) : (
          adapters.map((def) => (
            <Button key={def.key} onClick={() => void scale.connect(def)} disabled={scale.status?.state === 'connecting'}>
              <Scale aria-hidden className="size-5" /> Connect {def.label}
            </Button>
          ))
        )}
        {scale.error && <Notice tone="red">{scale.error}</Notice>}
        {note && <Notice>{note}</Notice>}
      </section>

      <Button variant={connected ? 'secondary' : 'primary'} onClick={() => dispatch({ type: 'use_scale', scale: null })}>
        <Keyboard aria-hidden className="size-5" /> Enter weight manually
      </Button>
    </div>
  );
}

// ---------------- STEP 3: weight ----------------

export function WeightStep({ draft, dispatch, scale }: { draft: CollectionDraft; dispatch: Dispatch; scale: UseScale }) {
  const usingScale = !!draft.scale && scale.status?.state === 'connected';
  const [manual, setManual] = useState(!usingScale);
  const [typed, setTyped] = useState(draft.weight?.source === 'MANUAL' ? String(draft.weight.kg) : '');
  const [busy, setBusy] = useState(false);
  const typedKg = parseKg(typed);
  const simulator = scale.adapter instanceof MockScaleAdapter ? scale.adapter : null;

  async function capture() {
    setBusy(true);
    const reading = await scale.capture();
    setBusy(false);
    if (!reading || !scale.status) return;
    dispatch({
      type: 'capture',
      weight: { kg: roundKg(reading.kg), source: SOURCE_OF_SCALE[scale.status.transport], tare_kg: null, captured_at: reading.at },
    });
  }

  if (!manual && usingScale) {
    const stable = !!scale.reading?.stable;
    return (
      <div className="space-y-4">
        <ScaleDisplay kg={scale.reading?.kg ?? 0} stable={stable} status={scale.status} />
        {simulator && (
          <Card className="border-dashed">
            <p className="text-xs font-bold uppercase tracking-wide text-[#1F4E86]">Simulator controls (development)</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[25, 50, 120].map((kg) => (
                <Button key={kg} variant="medium" onClick={() => simulator.placeLoad(kg + (Math.round(Math.random() * 90) / 100))}>
                  Load ~{kg} KG
                </Button>
              ))}
            </div>
            <Button variant="medium" className="mt-2 w-full" onClick={() => simulator.placeLoad(0)}>Empty scale</Button>
          </Card>
        )}
        {scale.error && <Notice tone="red">{scale.error}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => void scale.tare()} aria-label="Tare: set the scale to zero with the current load">TARE</Button>
          <Button variant="primary" onClick={() => void capture()} disabled={!stable || busy || !(scale.reading && scale.reading.kg > 0)}>
            CAPTURE
          </Button>
        </div>
        {!stable && <p className="text-center text-sm text-[#5E6B64]">Capture is available once the weight is stable.</p>}
        <button type="button" onClick={() => setManual(true)} className="mx-auto block min-h-12 text-sm font-semibold text-[#176044] underline underline-offset-2">
          Enter the weight manually instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScaleDisplay kg={typedKg ?? 0} stable status={null} manual />
      <div>
        <label htmlFor="manual-weight" className="mb-1 block text-sm font-bold">Total weight shown on the scale (KG)</label>
        <input
          id="manual-weight"
          inputMode="decimal"
          autoComplete="off"
          className={bigInput}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-invalid={typed !== '' && typedKg === null}
          aria-describedby="manual-weight-note"
          placeholder="e.g. 248.50"
        />
        <p id="manual-weight-note" className="mt-1 text-xs text-[#5E6B64]">
          Recorded as a MANUAL weight, never as a scale reading. Use up to 2 decimals.
        </p>
      </div>
      <Button
        variant="primary"
        disabled={typedKg === null}
        onClick={() => typedKg !== null && dispatch({ type: 'capture', weight: { kg: typedKg, source: 'MANUAL', tare_kg: null, captured_at: new Date().toISOString() } })}
      >
        Use {typedKg !== null ? formatKg(typedKg) : 'this weight'}
      </Button>
      {usingScale && (
        <button type="button" onClick={() => setManual(false)} className="mx-auto block min-h-12 text-sm font-semibold text-[#176044] underline underline-offset-2">
          Back to the scale reading
        </button>
      )}
    </div>
  );
}

// ---------------- STEP 4: allocation ----------------

export function AllocateStep({
  draft,
  dispatch,
  search,
}: {
  draft: CollectionDraft;
  dispatch: Dispatch;
  search: (term: string) => Promise<FarmerOption[]>;
}) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 200);
  const [answer, setAnswer] = useState<{ term: string; rows: FarmerOption[] } | null>(null);
  const results = answer?.rows ?? [];
  const searching = answer?.term !== debounced;
  const summary = summarize(draft.weight?.kg ?? null, draft.lines);
  const chosen = new Set(draft.lines.map((l) => l.farmer_id));

  useEffect(() => {
    let cancelled = false;
    search(debounced).then(
      (rows) => {
        if (!cancelled) setAnswer({ term: debounced, rows });
      },
      () => {
        if (!cancelled) setAnswer({ term: debounced, rows: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debounced, search]);

  return (
    <div className="space-y-4">
      <div className="sticky top-[57px] z-20 -mx-4 bg-[#F6F7F4] px-4 pb-2 pt-1">
        <AllocationSummaryCard summary={summary} />
      </div>

      <section aria-label="Allocations">
        <SectionTitle>Farmers in this collection ({draft.lines.length})</SectionTitle>
        {draft.lines.length === 0 && <p className="text-sm text-[#5E6B64]">Search below and add the farmers whose milk is in this weighing.</p>}
        <ul className="space-y-2">
          {draft.lines.map((line) => {
            const invalid = summary.invalidLines.includes(line.line_id) && line.quantity_kg !== '';
            const inputId = `kg-${line.line_id}`;
            return (
              <li key={line.line_id} className="rounded-2xl border border-[#DDE3DE] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{line.farmer_name}</p>
                    <p className="text-xs text-[#5E6B64]">{line.farmer_number}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'remove_line', line_id: line.line_id })}
                    aria-label={`Remove ${line.farmer_name}`}
                    className="inline-flex size-11 items-center justify-center rounded-full text-[#B42318] hover:bg-[#FDECEA]"
                  >
                    <X aria-hidden className="size-5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor={inputId} className="sr-only">KG for {line.farmer_name}</label>
                  <div className="relative flex-1">
                    <input
                      id={inputId}
                      inputMode="decimal"
                      autoComplete="off"
                      className={`${bigInput} pr-12 text-right font-mono font-bold`}
                      value={line.quantity_kg}
                      onChange={(e) => dispatch({ type: 'set_kg', line_id: line.line_id, quantity_kg: e.target.value })}
                      aria-invalid={invalid}
                      placeholder="0.00"
                    />
                    <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#5E6B64]">KG</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'fill_remaining', line_id: line.line_id })}
                    className="min-h-12 shrink-0 rounded-xl border border-[#C9D2CB] bg-white px-3 text-xs font-semibold"
                    disabled={summary.remainingCents <= 0 && parseKg(line.quantity_kg) === null}
                  >
                    Rest
                  </button>
                </div>
                {invalid && <p className="mt-1 text-xs font-semibold text-[#B42318]">Enter KG above 0, up to 2 decimals.</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Add farmers">
        <SectionTitle>Add a farmer</SectionTitle>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#8A968F]" />
          <label htmlFor="farmer-search" className="sr-only">Search farmers by name, number or phone</label>
          <input
            id="farmer-search"
            type="search"
            className={`${bigInput} pl-12`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Name, farmer number or phone"
            autoComplete="off"
          />
        </div>
        <ul className="mt-2 divide-y divide-[#EEF1EC] rounded-2xl border border-[#DDE3DE] bg-white" aria-busy={searching} aria-label="Matching farmers">
          {results.length === 0 && <li className="p-4 text-sm text-[#5E6B64]">{searching ? 'Searching…' : 'No matching active farmers.'}</li>}
          {results.map((f) => {
            const added = chosen.has(f.id);
            return (
              <li key={f.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{f.full_name}</p>
                  <p className="text-xs text-[#5E6B64]">{f.farmer_number}{f.phone ? ` · ${f.phone}` : ''}</p>
                </div>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => dispatch({ type: 'add_farmer', farmer: f })}
                  aria-label={added ? `${f.full_name} already added` : `Add ${f.full_name}`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-[#176044] px-3 text-sm font-semibold text-white disabled:bg-[#EEF1EC] disabled:text-[#5E6B64]"
                >
                  {added ? 'Added' : (<><Plus aria-hidden className="size-4" />Add</>)}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------------- STEP 5: review ----------------

export function ReviewStep({
  draft,
  dispatch,
  cooperativeName,
  collectorName,
  online,
  syncLabel,
  error,
}: {
  draft: CollectionDraft;
  dispatch: Dispatch;
  cooperativeName: string | null;
  collectorName: string | null;
  online: boolean;
  syncLabel: string;
  error: string | null;
}) {
  const summary = summarize(draft.weight?.kg ?? null, draft.lines);
  const problems = blockers(draft);
  const now = new Date();
  const rows: [string, React.ReactNode][] = [
    ['Collection reference', 'Assigned when the server receives it'],
    ['Date / time', now.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Cooperative', cooperativeName ?? '–'],
    ['Centre', draft.cooler?.centre_name ?? '–'],
    ['Cooler', draft.cooler ? `${draft.cooler.name} (${draft.cooler.code})` : '–'],
    ['Collector', collectorName ?? '–'],
    ['Scale', draft.weight?.source === 'MANUAL' ? 'Manual entry (no scale)' : `${draft.scale?.name ?? '–'}${draft.weight?.source === 'SIMULATED' ? ' — SIMULATED' : ''}`],
    ['Total weight', formatKg(draft.weight?.kg)],
    ['Farmers', String(draft.lines.length)],
    ['Remaining (not allocated)', formatKg(summary.remainingCents / 100)],
    ['Connection', online ? 'Online' : 'Offline — will be saved on this phone'],
    ['Sync', syncLabel],
  ];
  return (
    <div className="space-y-4">
      <Card>
        <dl className="divide-y divide-[#EEF1EC] text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2">
              <dt className="text-[#5E6B64]">{label}</dt>
              <dd className="text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <section aria-label="Individual allocations">
        <SectionTitle>Allocations</SectionTitle>
        <ul className="divide-y divide-[#EEF1EC] rounded-2xl border border-[#DDE3DE] bg-white">
          {draft.lines.map((l) => (
            <li key={l.line_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{l.farmer_name}</span>
                <span className="text-xs text-[#5E6B64]">{l.farmer_number}</span>
              </span>
              <span className="font-mono font-bold tabular-nums">{formatKg(parseKg(l.quantity_kg))}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Quality information" className="space-y-3">
        <SectionTitle>Quality (optional)</SectionTitle>
        <div>
          <label htmlFor="temperature" className="mb-1 block text-sm font-bold">Milk temperature °C</label>
          <input id="temperature" inputMode="decimal" className={bigInput} value={draft.temperature_c} onChange={(e) => dispatch({ type: 'set_field', field: 'temperature_c', value: e.target.value })} />
        </div>
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-bold">Notes</label>
          <textarea id="notes" rows={2} className={bigInput} value={draft.notes} onChange={(e) => dispatch({ type: 'set_field', field: 'notes', value: e.target.value })} />
        </div>
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[#DDE3DE] bg-white px-4">
          <input type="checkbox" className="size-5 accent-[#176044]" checked={draft.send_receipts} onChange={(e) => dispatch({ type: 'set_receipts', value: e.target.checked })} />
          <span className="text-sm font-semibold">Send each farmer an SMS receipt</span>
        </label>
        <p className="text-xs text-[#5E6B64]">SMS receipts are sent by the server after this collection syncs, if the cooperative has SMS credits and an SMS provider. Offline, they wait in the queue.</p>
      </section>
      {problems.length > 0 && (
        <Notice tone="red">
          <p className="font-bold">Can’t confirm yet:</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Notice>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

/** Back / Confirm Collection. Confirm is disabled while anything blocks the batch or a save is running. */
export function ConfirmBar({ draft, submitting, onBack, onConfirm }: { draft: CollectionDraft; submitting: boolean; onBack: () => void; onConfirm: () => void }) {
  const problems = blockers(draft);
  return (
    <div className="pb-safe sticky bottom-0 -mx-4 mt-6 grid grid-cols-[1fr_2fr] gap-3 border-t border-[#DDE3DE] bg-[#F6F7F4] px-4 pt-3">
      <Button onClick={onBack} disabled={submitting}>Back</Button>
      <Button
        variant="primary"
        onClick={onConfirm}
        disabled={submitting || problems.length > 0}
        aria-busy={submitting}
        aria-describedby={problems.length ? 'confirm-blockers' : undefined}
      >
        {submitting ? 'Saving…' : 'Confirm Collection'}
      </Button>
      {problems.length > 0 && <p id="confirm-blockers" className="sr-only">{problems.join(' ')}</p>}
    </div>
  );
}

// ---------------- STEP 6: success ----------------

export function SuccessStep({
  draft,
  syncStatus,
  receiptStatuses,
  onNew,
}: {
  draft: CollectionDraft;
  syncStatus: RecordSyncStatus | null;
  receiptStatuses: (string | null)[];
  onNew: () => void;
}) {
  const result = (draft.result ?? {}) as { id?: string; reference?: string };
  const saved = syncStatus === 'synced';
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-[#E3F1E9]">
        {saved ? <CheckCircle2 aria-hidden className="size-12 text-[#176044]" /> : <CloudOff aria-hidden className="size-11 text-[#8A5A0B]" />}
      </div>
      <div>
        <h2 className="text-2xl font-bold">{saved ? 'Collection confirmed' : 'Saved on this device'}</h2>
        <p className="mt-1 text-[#5E6B64]" role="status">
          {saved ? 'The server has recorded this collection.' : 'Will sync when connection returns.'}
        </p>
      </div>
      <Card className="text-left">
        <dl className="divide-y divide-[#EEF1EC] text-sm">
          {([
            ['Collection ID', <span key="id" className="break-all font-mono text-xs">{result.id ?? draft.id}</span>],
            ['Collection reference', saved && result.reference && result.reference !== 'Pending sync' ? result.reference : 'Assigned after sync'],
            ['Total KG', formatKg(draft.weight?.kg)],
            ['Farmers', String(draft.lines.length)],
            ['SMS receipts', receiptSummary(receiptStatuses, syncStatus)],
            ['Sync status', saved ? 'Synced' : syncStatus === 'failed' || syncStatus === 'conflict' ? 'Sync error — see Sync' : 'Pending sync'],
          ] as [string, React.ReactNode][]).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2">
              <dt className="text-[#5E6B64]">{label}</dt>
              <dd className="text-right font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="grid gap-3">
        <Button variant="primary" onClick={onNew}><Plus aria-hidden className="size-5" /> New Collection</Button>
        <Link href={`/collector/collections?id=${encodeURIComponent(result.id ?? draft.id)}`} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#C9D2CB] bg-white px-5 text-base font-bold">
          View Collection
        </Link>
      </div>
    </div>
  );
}

