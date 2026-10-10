'use client';

// New collection: Cooler -> Scale -> Weight -> Farmers -> Review -> Done.
// The draft is saved on the phone after every change and keeps one batch id from start to finish, so a reload
// resumes where the collector was and confirming twice can never create two collections.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, X } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import {
  confirmBatch, coolerOptions, loadDraft, saveDraft, searchFarmers, type Batch, type CoolerOption,
} from '@/lib/collections/batch-client';
import { blockers, canGo, newDraft, reduceDraft, STEP_LABEL, STEPS, type CollectionDraft, type DraftAction, type DraftStep } from '@/lib/collections/draft';
import { hasUserDb } from '@/lib/offline/db';
import { getRawRow } from '@/lib/offline/repositories';
import type { RecordSyncStatus } from '@/lib/offline/types';
import { useScale } from '@/lib/scale/use-scale';
import { useIsOnline, useLocalQuery, useSyncState } from '@/lib/sync/hooks';
import { useWorkingCooler } from '@/lib/hooks/use-working-cooler';
import { useCollector } from './collector-context';
import { Button } from './ui';
import { AllocateStep, ConfirmBar, CoolerStep, ReviewStep, ScaleStep, SuccessStep, WeightStep } from './wizard-steps';

const VISIBLE_STEPS = STEPS.filter((s) => s !== 'done');
const PREVIOUS: Partial<Record<DraftStep, DraftStep>> = { scale: 'cooler', weight: 'scale', allocate: 'weight', review: 'allocate' };

type State = CollectionDraft | null;
function reducer(state: State, action: DraftAction | { type: 'load'; draft: CollectionDraft }): State {
  if (action.type === 'load') return action.draft;
  return state ? reduceDraft(state, action) : state;
}

export function CollectionWizard() {
  const router = useRouter();
  const collector = useCollector();
  const online = useIsOnline();
  const sync = useSyncState();
  const scale = useScale();
  const [draft, dispatch] = useReducer(reducer, null);
  const [coolers, setCoolers] = useState<CoolerOption[]>([]);
  const [assignedCoolerId, setDefaultCoolerId] = useState<string | null>(null);
  // The cooler chosen in the header is pre-selected; it is still shown as a choice, never skipped.
  const [defaultCoolerId] = useWorkingCooler(`collector.${collector.userId ?? ''}`, coolers.map((c) => c.id), assignedCoolerId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [cooperativeName, setCooperativeName] = useState<string | null>(null);

  // Load the saved draft (or start one) and the coolers to choose from.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [saved, options] = await Promise.all([loadDraft(), coolerOptions()]);
        if (cancelled) return;
        setCoolers(options.coolers);
        setDefaultCoolerId(options.defaultCoolerId);
        // A new collection always starts at the cooler step: the collector confirms where they are
        // (their assigned cooler is listed first).
        dispatch({ type: 'load', draft: saved && saved.status !== 'CONFIRMED' ? saved : newDraft(null) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load coolers.');
        dispatch({ type: 'load', draft: newDraft(null) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    if (hasUserDb()) {
      void import('@/lib/offline/repositories').then(({ cooperativeRow }) =>
        cooperativeRow<{ name: string }>().then((c) => !cancelled && setCooperativeName(c?.name ?? null)),
      );
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist after every change; a confirmed collection leaves the draft store.
  useEffect(() => {
    if (!draft) return;
    void saveDraft(draft.status === 'CONFIRMED' ? null : draft);
  }, [draft]);

  const confirm = useCallback(async () => {
    if (!draft || submittingRef.current) return; // a second tap while the first is in flight does nothing
    if (blockers(draft).length) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const outcome = await confirmBatch(draft);
      await scale.disconnect();
      dispatch({ type: 'confirmed', result: { ...outcome.batch, sync_status: outcome.status } as unknown as Record<string, unknown> });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the collection. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [draft, scale]);

  // Live sync / receipt state of the confirmed batch (updates when it syncs and when SMS results arrive).
  const confirmedId = draft?.status === 'CONFIRMED' ? draft.id : null;
  const live = useLocalQuery(
    () => (confirmedId && hasUserDb() ? getRawRow('batches', confirmedId) : Promise.resolve(undefined)),
    ['batches'],
    [confirmedId],
  );
  const liveRow = live.data as (Batch & { _status?: RecordSyncStatus }) | undefined;
  const resultStatus = (draft?.result?.sync_status as RecordSyncStatus | undefined) ?? null;
  const syncStatus: RecordSyncStatus | null = liveRow?._status ?? resultStatus;
  const receiptStatuses = (liveRow?.lines ?? (draft?.result?.lines as Batch['lines'] | undefined) ?? []).map((l) => l.receipt_status);

  if (!draft || loading) return <p role="status" className="py-16 text-center text-[#5E6B64]">Preparing a new collection…</p>;

  const stepIndex = VISIBLE_STEPS.indexOf(draft.step as (typeof VISIBLE_STEPS)[number]);
  const previous = PREVIOUS[draft.step];
  const done = draft.step === 'done';
  const waiting = sync.counts.pending + sync.counts.syncing;
  const syncLabel = sync.phase === 'syncing' ? 'Syncing…' : online ? (waiting ? `${waiting} waiting to sync` : 'Up to date') : 'Offline — pending sync after confirming';

  function exit() {
    if (!draft || done || (draft.lines.length === 0 && !draft.weight) || window.confirm('Leave this collection? It stays saved on this phone as a draft.')) {
      router.push('/collector');
    }
  }

  return (
    <div>
      {!done && (
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => (previous ? dispatch({ type: 'go', step: previous }) : exit())}
              aria-label={previous ? `Back to ${STEP_LABEL[previous]}` : 'Back to home'}
              className="inline-flex size-11 items-center justify-center rounded-full hover:bg-[#EEF1EC]"
            >
              <ArrowLeft aria-hidden className="size-6" />
            </button>
            <p className="text-sm font-semibold text-[#5E6B64]" aria-live="polite">
              Step {stepIndex + 1} of {VISIBLE_STEPS.length} · {STEP_LABEL[draft.step]}
            </p>
            <button type="button" onClick={exit} aria-label="Close" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-[#EEF1EC]">
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="Progress">
            {VISIBLE_STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={!canGo(draft, s)}
                  onClick={() => dispatch({ type: 'go', step: s })}
                  aria-current={s === draft.step ? 'step' : undefined}
                  aria-label={`${STEP_LABEL[s]}${i < stepIndex ? ' (done)' : ''}`}
                  className={`h-2 w-full rounded-full ${i <= stepIndex ? 'bg-[#176044]' : 'bg-[#DDE3DE]'} disabled:cursor-default`}
                />
              </li>
            ))}
          </ol>
          <h1 className="mt-4 text-2xl font-bold">
            {{ cooler: 'Select cooler', scale: 'Connect scale', weight: 'Capture weight', allocate: 'Allocate to farmers', review: 'Review & confirm', done: '' }[draft.step]}
          </h1>
        </div>
      )}

      {draft.step === 'cooler' && <CoolerStep coolers={coolers} defaultCoolerId={defaultCoolerId} draft={draft} dispatch={dispatch} loading={loading} />}
      {draft.step === 'scale' && <ScaleStep draft={draft} dispatch={dispatch} scale={scale} />}
      {draft.step === 'weight' && <WeightStep draft={draft} dispatch={dispatch} scale={scale} />}
      {draft.step === 'allocate' && <AllocateStep draft={draft} dispatch={dispatch} search={searchFarmers} />}
      {draft.step === 'review' && (
        <ReviewStep
          draft={draft} dispatch={dispatch} cooperativeName={cooperativeName} collectorName={collector.name}
          online={online} syncLabel={syncLabel} error={error}
        />
      )}
      {done && (
        <SuccessStep
          draft={{ ...draft, result: { ...(draft.result ?? {}), ...(liveRow ? { id: liveRow.id, reference: liveRow.reference } : {}) } }}
          syncStatus={syncStatus}
          receiptStatuses={receiptStatuses}
          onNew={() => dispatch({ type: 'reset' })}
        />
      )}

      {draft.step === 'allocate' && (
        <div className="pb-safe sticky bottom-0 -mx-4 mt-6 border-t border-[#DDE3DE] bg-[#F6F7F4] px-4 pt-3">
          <Button variant="primary" disabled={!canGo(draft, 'review')} onClick={() => dispatch({ type: 'go', step: 'review' })}>
            Review {draft.lines.length ? `(${draft.lines.length} farmer${draft.lines.length === 1 ? '' : 's'})` : ''}
          </Button>
        </div>
      )}
      {draft.step === 'review' && (
        <ConfirmBar draft={draft} submitting={submitting} onBack={() => dispatch({ type: 'go', step: 'allocate' })} onConfirm={() => void confirm()} />
      )}
    </div>
  );
}
