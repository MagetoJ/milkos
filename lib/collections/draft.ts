// The collector's new-collection workflow as a state machine. The draft lives on the device (IndexedDB),
// so a reload or a dead battery never loses a half-finished collection, and it carries a client-generated
// batch id from the first step: confirming twice, or resending after a lost connection, is the same batch.
//
//   status  DRAFT ──capture──> CAPTURED ──add farmer──> ALLOCATING ──confirm──> CONFIRMED
//   steps   cooler -> scale -> weight -> allocate -> review -> done
//
// After CONFIRMED the batch is in the sync queue; its sync state (pending / syncing / synced / failed) is
// the sync engine's, shown next to it.
import { uuid } from '@/lib/offline/ids';
import { confirmBlockers, fillRemaining, type AllocationLine } from './allocation';
import type { WeightSource } from '@/lib/scale/types';

export type DraftStatus = 'DRAFT' | 'CAPTURED' | 'ALLOCATING' | 'CONFIRMED';
export type DraftStep = 'cooler' | 'scale' | 'weight' | 'allocate' | 'review' | 'done';
export const STEPS: DraftStep[] = ['cooler', 'scale', 'weight', 'allocate', 'review', 'done'];
export const STEP_LABEL: Record<DraftStep, string> = {
  cooler: 'Cooler',
  scale: 'Scale',
  weight: 'Weight',
  allocate: 'Farmers',
  review: 'Review',
  done: 'Done',
};

export interface DraftCooler {
  id: string;
  name: string;
  code: string;
  centre_id: string | null;
  centre_name: string | null;
}

export interface DraftScale {
  key: string;
  name: string;
  identifier: string | null;
  transport: string;
}

export interface DraftWeight {
  kg: number;
  source: WeightSource;
  tare_kg: number | null;
  captured_at: string;
}

export interface CollectionDraft {
  id: string;
  status: DraftStatus;
  step: DraftStep;
  started_at: string;
  cooler: DraftCooler | null;
  scale: DraftScale | null;
  weight: DraftWeight | null;
  lines: AllocationLine[];
  temperature_c: string;
  notes: string;
  send_receipts: boolean;
  confirmed_at: string | null;
  /** Server/local record after confirmation (reference, sync status...). */
  result: Record<string, unknown> | null;
}

export type DraftAction =
  | { type: 'select_cooler'; cooler: DraftCooler }
  | { type: 'use_scale'; scale: DraftScale | null }
  | { type: 'capture'; weight: DraftWeight }
  | { type: 'clear_weight' }
  | { type: 'add_farmer'; farmer: { id: string; full_name: string; farmer_number: string; phone?: string | null }; quantity_kg?: string }
  | { type: 'set_kg'; line_id: string; quantity_kg: string }
  | { type: 'fill_remaining'; line_id: string }
  | { type: 'remove_line'; line_id: string }
  | { type: 'set_field'; field: 'temperature_c' | 'notes'; value: string }
  | { type: 'set_receipts'; value: boolean }
  | { type: 'go'; step: DraftStep }
  | { type: 'confirmed'; result: Record<string, unknown> }
  | { type: 'reset'; cooler?: DraftCooler | null };

export function newDraft(cooler: DraftCooler | null = null, now = new Date()): CollectionDraft {
  return {
    id: uuid(),
    status: 'DRAFT',
    step: cooler ? 'scale' : 'cooler',
    started_at: now.toISOString(),
    cooler,
    scale: null,
    weight: null,
    lines: [],
    temperature_c: '',
    notes: '',
    send_receipts: true,
    confirmed_at: null,
    result: null,
  };
}

/** Steps the collector may open from here (no skipping ahead past missing data). */
export function canGo(draft: CollectionDraft, step: DraftStep): boolean {
  if (draft.status === 'CONFIRMED') return step === 'done';
  switch (step) {
    case 'cooler':
      return true;
    case 'scale':
    case 'weight':
      return !!draft.cooler;
    case 'allocate':
      return !!draft.cooler && !!draft.weight;
    case 'review':
      return !!draft.cooler && !!draft.weight && draft.lines.length > 0;
    case 'done':
      return false;
  }
}

export function blockers(draft: CollectionDraft): string[] {
  return confirmBlockers({
    totalKg: draft.weight?.kg ?? null,
    lines: draft.lines,
    coolerId: draft.cooler?.id ?? null,
    weightSource: draft.weight?.source ?? null,
  });
}

function editable(draft: CollectionDraft): boolean {
  return draft.status !== 'CONFIRMED';
}

export function reduceDraft(draft: CollectionDraft, action: DraftAction): CollectionDraft {
  if (action.type === 'reset') return newDraft(action.cooler ?? null);
  if (!editable(draft) && action.type !== 'go') return draft; // a confirmed collection never changes here
  switch (action.type) {
    case 'select_cooler':
      return { ...draft, cooler: action.cooler, step: 'scale' };
    case 'use_scale':
      return { ...draft, scale: action.scale, step: 'weight' };
    case 'capture':
      return {
        ...draft,
        weight: action.weight,
        status: draft.lines.length ? 'ALLOCATING' : 'CAPTURED',
        step: 'allocate',
      };
    case 'clear_weight':
      return { ...draft, weight: null, status: 'DRAFT', step: 'weight' };
    case 'add_farmer': {
      if (draft.lines.some((l) => l.farmer_id === action.farmer.id)) return draft; // one line per farmer
      const line: AllocationLine = {
        line_id: uuid(),
        farmer_id: action.farmer.id,
        farmer_name: action.farmer.full_name,
        farmer_number: action.farmer.farmer_number,
        phone: action.farmer.phone ?? null,
        quantity_kg: action.quantity_kg ?? '',
      };
      return { ...draft, lines: [...draft.lines, line], status: draft.weight ? 'ALLOCATING' : draft.status };
    }
    case 'set_kg':
      return { ...draft, lines: draft.lines.map((l) => (l.line_id === action.line_id ? { ...l, quantity_kg: action.quantity_kg } : l)) };
    case 'fill_remaining':
      return { ...draft, lines: fillRemaining(draft.weight?.kg ?? null, draft.lines, action.line_id) };
    case 'remove_line': {
      const lines = draft.lines.filter((l) => l.line_id !== action.line_id);
      return { ...draft, lines, status: draft.weight ? (lines.length ? 'ALLOCATING' : 'CAPTURED') : 'DRAFT' };
    }
    case 'set_field':
      return { ...draft, [action.field]: action.value };
    case 'set_receipts':
      return { ...draft, send_receipts: action.value };
    case 'go':
      return canGo(draft, action.step) ? { ...draft, step: action.step } : draft;
    case 'confirmed':
      return { ...draft, status: 'CONFIRMED', step: 'done', confirmed_at: new Date().toISOString(), result: action.result };
  }
}
