// Collection batches: confirm, list and look up, offline-first.
//
// Confirming goes through the existing sync queue (lib/offline/mutations.saveChange) with the batch id the
// draft generated at its first step, so:
//   online   the server answers at once (refusals come back to the review screen, like any form);
//   offline  the batch is saved on this device as "pending sync" and pushed when the connection returns;
//   resend   the same id is never confirmed twice (the server answers "duplicate").
// Corrections and reversals need a connection: they are reviewed by another person on the server.
import { maskPhone } from '@/lib/format';
import { ApiError, createApi, NEEDS_CONNECTION, send, toQuery } from '@/lib/api-client';
import { getMeta, hasUserDb, setMeta, userDb } from '@/lib/offline/db';
import { nowIso } from '@/lib/offline/ids';
import { saveChange } from '@/lib/offline/mutations';
import { farmerMatches, getRawRow, initialSyncDone, publicRow } from '@/lib/offline/repositories';
import { getActiveSession } from '@/lib/offline/session';
import type { LocalMeta, RecordSyncStatus } from '@/lib/offline/types';
import { pendingMutationIdsFor } from '@/lib/sync/queue';
import { parseKg, summarize } from './allocation';
import { blockers, type CollectionDraft } from './draft';

const batchesApi = createApi('/api/v1/collection-batches');
const requestsApi = createApi('/api/v1/collection-requests');
const collectionsApi = createApi('/api/v1/collections');

export interface BatchLine {
  id: string;
  reference: string;
  farmer_id: string;
  farmer_name: string;
  farmer_number: string;
  quantity_kg: number;
  quantity_litres?: number | null;
  quality_status?: string;
  record_status?: string;
  receipt_status: string | null;
  receipt_error?: string | null;
}

export interface Batch {
  id: string;
  reference: string;
  status: string;
  cooperative_id: string;
  centre_id: string | null;
  centre_name: string | null;
  cooler_id: string | null;
  cooler_name: string | null;
  cooler_code?: string | null;
  collector_id: string | null;
  collector_name: string | null;
  collection_date: string;
  collection_time: string | null;
  captured_weight_kg: number;
  allocated_weight_kg: number;
  remaining_weight_kg: number;
  weight_source: string;
  scale_name: string | null;
  scale_identifier?: string | null;
  temperature_c?: number | null;
  notes?: string | null;
  send_receipts: boolean;
  farmer_count: number;
  lines: BatchLine[];
  pending_request?: { id: string; type: string } | null;
  supersedes_batch_id?: string | null;
  superseded_by_batch_id?: string | null;
  sync_status?: RecordSyncStatus;
  sync_error?: string | null;
  created_at?: string | null;
}

export interface BatchDetail extends Batch {
  requests: CorrectionRequest[];
  can_request_correction: boolean;
  can_request_reversal: boolean;
}

export interface CorrectionRequest {
  id: string;
  batch_id: string;
  batch_reference: string;
  batch_status: string;
  request_type: 'CORRECTION' | 'REVERSAL';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  original_values: Record<string, unknown>;
  proposed_values: Record<string, unknown> | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_role: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  resulting_batch_id: string | null;
  resulting_batch_reference: string | null;
  /** "Name (F-0001)" for the farmers in the recorded and proposed allocations. */
  farmer_names?: Record<string, string>;
  created_at: string;
}

type Row = Record<string, unknown> & LocalMeta & { id: string };

async function localReady() {
  return hasUserDb() && (await initialSyncDone());
}

// ---------------- the draft (kept on this device) ----------------

const DRAFT_KEY = 'collection_draft';

export async function loadDraft(): Promise<CollectionDraft | null> {
  if (!hasUserDb()) return null;
  return (await getMeta<CollectionDraft>(userDb(), DRAFT_KEY)) ?? null;
}

export async function saveDraft(draft: CollectionDraft | null): Promise<void> {
  if (!hasUserDb()) return;
  await setMeta(userDb(), DRAFT_KEY, draft);
}

// ---------------- what the collector chooses from ----------------

export interface CoolerOption {
  id: string;
  name: string;
  code: string;
  centre_id: string | null;
  centre_name: string | null;
  is_operational: boolean;
  current_volume_litres: number | null;
  capacity_litres: number | null;
  last_temperature_c: number | null;
}

export interface FarmerOption {
  id: string;
  full_name: string;
  farmer_number: string;
  /** Always masked (0712••••78): the collection screens never need a farmer's full number. */
  phone: string | null;
  centre_id: string | null;
}

const masked = (row: { phone?: unknown; phone_masked?: unknown }): string | null =>
  (row.phone_masked as string | undefined) ?? (row.phone ? maskPhone(String(row.phone)) : null);

export async function coolerOptions(): Promise<{ coolers: CoolerOption[]; defaultCoolerId: string | null }> {
  if (await localReady()) {
    const session = await getActiveSession();
    const rows = ((await userDb().coolers.where('status').equals('ACTIVE').toArray()) as Row[]).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const mine = session?.user.role === 'COLLECTOR'
      ? ((await userDb().collectors.toArray()) as Row[]).find((c) => c.user_id === session.userId)
      : undefined;
    return {
      coolers: rows.map((c) => ({
        id: c.id, name: String(c.name), code: String(c.code), centre_id: (c.centre_id as string) ?? null,
        centre_name: (c.centre_name as string) ?? null, is_operational: !!c.is_operational,
        current_volume_litres: (c.current_volume_litres as number) ?? null, capacity_litres: (c.capacity_litres as number) ?? null,
        last_temperature_c: (c.last_temperature_c as number) ?? null,
      })),
      defaultCoolerId: (mine?.cooler_id as string | undefined) ?? null,
    };
  }
  const data = await collectionsApi<{
    coolers: (CoolerOption & { label: string })[];
    default_cooler_id?: string | null;
  }>('/options');
  return { coolers: data.coolers, defaultCoolerId: data.default_cooler_id ?? null };
}

export async function searchFarmers(search: string, limit = 20): Promise<FarmerOption[]> {
  if (await localReady()) {
    const rows = ((await userDb().farmers.where('status').equals('ACTIVE').toArray()) as Row[])
      .filter((f) => farmerMatches(f, search))
      .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name)) || String(a.first_name).localeCompare(String(b.first_name)))
      .slice(0, limit);
    return rows.map((f) => ({
      id: f.id, full_name: String(f.full_name), farmer_number: String(f.farmer_number), phone: masked({ phone: f.phone, phone_masked: f.phone_masked }),
      centre_id: (f.centre_id as string) ?? null,
    }));
  }
  const data = await collectionsApi<{ farmers: (FarmerOption & { phone_masked?: string })[] }>(`/options${toQuery({ search })}`);
  return data.farmers.slice(0, limit).map((f) => ({ ...f, phone: masked(f) }));
}

// ---------------- confirming ----------------

export function batchPayload(draft: CollectionDraft): Record<string, unknown> {
  const temperature = draft.temperature_c.trim() === '' ? null : Number(draft.temperature_c);
  return {
    cooler_id: draft.cooler?.id ?? null,
    centre_id: draft.cooler?.centre_id ?? null,
    captured_weight_kg: draft.weight?.kg,
    tare_weight_kg: draft.weight?.tare_kg ?? null,
    weight_source: draft.weight?.source,
    // A manual weight never names a scale (the server refuses it).
    scale_name: draft.weight?.source === 'MANUAL' ? null : (draft.scale?.name ?? null),
    scale_identifier: draft.weight?.source === 'MANUAL' ? null : (draft.scale?.identifier ?? null),
    temperature_c: Number.isFinite(temperature) ? temperature : null,
    notes: draft.notes.trim() || null,
    send_receipts: draft.send_receipts,
    started_at: draft.started_at,
    captured_at: draft.weight?.captured_at ?? null,
    confirmed_at: nowIso(),
    allocations: draft.lines.map((l) => ({ id: l.line_id, farmer_id: l.farmer_id, quantity_kg: parseKg(l.quantity_kg) })),
  };
}

/** The batch as it looks on this device before the server has it (same shape as the server's). */
function optimisticBatch(draft: CollectionDraft, session: Awaited<ReturnType<typeof getActiveSession>>, collector: Row | undefined) {
  const s = summarize(draft.weight?.kg ?? null, draft.lines);
  const now = new Date();
  return {
    id: draft.id,
    reference: 'Pending sync',
    status: 'CONFIRMED',
    cooperative_id: session?.user.cooperative_id ?? '',
    centre_id: draft.cooler?.centre_id ?? null,
    centre_name: draft.cooler?.centre_name ?? null,
    cooler_id: draft.cooler?.id ?? null,
    cooler_name: draft.cooler?.name ?? null,
    cooler_code: draft.cooler?.code ?? null,
    collector_id: (collector?.id as string | undefined) ?? null,
    collector_name: (collector?.full_name as string | undefined) ?? session?.user.full_name ?? null,
    collection_date: now.toISOString().slice(0, 10),
    collection_time: now.toISOString().slice(11, 16),
    captured_weight_kg: s.totalCents / 100,
    allocated_weight_kg: s.allocatedCents / 100,
    remaining_weight_kg: s.remainingCents / 100,
    weight_source: draft.weight?.source ?? 'MANUAL',
    scale_name: draft.weight?.source === 'MANUAL' ? null : (draft.scale?.name ?? null),
    send_receipts: draft.send_receipts,
    farmer_count: draft.lines.length,
    lines: draft.lines.map((l) => ({
      id: l.line_id, reference: 'Pending sync', farmer_id: l.farmer_id, farmer_name: l.farmer_name,
      farmer_number: l.farmer_number, quantity_kg: parseKg(l.quantity_kg) ?? 0, receipt_status: null, record_status: 'ACTIVE',
    })),
    pending_request: null,
    created_at: nowIso(),
  };
}

export interface ConfirmOutcome {
  batch: Batch;
  /** 'synced' = the server has it; 'pending' = saved on this device, waiting to sync. */
  status: RecordSyncStatus;
}

export async function confirmBatch(draft: CollectionDraft): Promise<ConfirmOutcome> {
  const problems = blockers(draft);
  if (problems.length) throw new ApiError(422, problems[0], { form: problems[0] });
  const payload = batchPayload(draft);

  if (!hasUserDb()) {
    // No offline session on this device: straight to the server (the id still makes a resend harmless).
    const batch = await batchesApi<Batch>('', send('POST', { ...payload, id: draft.id }));
    return { batch, status: 'synced' };
  }

  const db = userDb();
  // A second tap (or a reload after confirming) must not queue the same batch again.
  const existing = await getRawRow('batches', draft.id);
  if (existing) return { batch: publicRow<Batch>(existing as never), status: existing._status };

  const session = await getActiveSession();
  const collector = session?.user.role === 'COLLECTOR'
    ? ((await db.collectors.toArray()) as Row[]).find((c) => c.user_id === session.userId)
    : undefined;
  const { record, status } = await saveChange<Batch>({
    mutation: {
      entity_type: 'collection_batch', operation: 'create', local_id: draft.id, table: 'batches', payload,
      // Farmers registered offline must reach the server before a batch that pays them.
      depends_on: await pendingMutationIdsFor(db, draft.lines.map((l) => l.farmer_id)),
    },
    table: 'batches',
    entity: 'collection_batch',
    interactive: true,
    optimistic: optimisticBatch(draft, session, collector),
  });
  return { batch: record, status };
}

// ---------------- reading ----------------

export interface BatchPage {
  items: Batch[];
  total: number;
  summary?: { batches: number; captured_kg: number; allocated_kg: number };
  offline?: boolean;
}

export async function listBatches(params: { search?: string; date_from?: string; date_to?: string; page?: number; page_size?: number } = {}): Promise<BatchPage> {
  const page = params.page ?? 1;
  const size = params.page_size ?? 25;
  if (await localReady()) {
    const terms = (params.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = ((await userDb().batches.toArray()) as Row[])
      .filter((b) => {
        if (params.date_from && String(b.collection_date) < params.date_from) return false;
        if (params.date_to && String(b.collection_date) > params.date_to) return false;
        const lines = (b.lines as BatchLine[] | undefined) ?? [];
        const text = [b.reference, b.cooler_name, ...lines.map((l) => `${l.farmer_name} ${l.farmer_number}`)].join(' ').toLowerCase();
        return terms.every((t) => text.includes(t));
      })
      .sort((a, b) => `${b.collection_date} ${b.collection_time}`.localeCompare(`${a.collection_date} ${a.collection_time}`) || String(b._local_created_at).localeCompare(String(a._local_created_at)));
    const items = rows.slice((page - 1) * size, page * size).map((r) => publicRow<Batch>(r));
    return { items, total: rows.length, offline: true };
  }
  return batchesApi<BatchPage>(toQuery({ ...params, page, page_size: size }));
}

export async function getBatch(id: string, { online = true }: { online?: boolean } = {}): Promise<BatchDetail | Batch | null> {
  if (online) {
    try {
      return await batchesApi<BatchDetail>(`/${id}`);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) throw e;
    }
  }
  if (hasUserDb()) {
    const row = await getRawRow('batches', id);
    return row ? publicRow<Batch>(row as never) : null;
  }
  return null;
}

/** Today's figures for the collector home screen, from this device's data. */
export async function todayStats(): Promise<{ kg: number; batches: number; farmers: number; pending: number }> {
  if (!hasUserDb()) return { kg: 0, batches: 0, farmers: 0, pending: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const rows = ((await userDb().batches.where('collection_date').equals(today).toArray()) as Row[])
    .filter((b) => ['CONFIRMED', 'CORRECTION_PENDING', 'REVERSAL_PENDING'].includes(String(b.status)));
  const farmers = new Set(rows.flatMap((b) => ((b.lines as BatchLine[] | undefined) ?? []).map((l) => l.farmer_id)));
  return {
    kg: Math.round(rows.reduce((s, b) => s + Number(b.allocated_weight_kg ?? 0), 0) * 100) / 100,
    batches: rows.length,
    farmers: farmers.size,
    pending: rows.filter((b) => b._status !== 'synced').length,
  };
}

// ---------------- corrections & reversals (online) ----------------

function needsConnection(e: unknown): never {
  if (e instanceof ApiError && e.status === 0) throw new ApiError(0, NEEDS_CONNECTION);
  throw e;
}

export async function requestCorrection(batchId: string, reason: string, proposed: Record<string, unknown>) {
  return batchesApi<CorrectionRequest>(`/${batchId}/corrections`, send('POST', { reason, proposed })).catch(needsConnection);
}

export async function requestReversal(batchId: string, reason: string) {
  return batchesApi<CorrectionRequest>(`/${batchId}/reversals`, send('POST', { reason })).catch(needsConnection);
}

export interface RequestPage {
  items: CorrectionRequest[];
  total: number;
  page: number;
  page_size: number;
  pending: number;
  can_approve_corrections: boolean;
  can_approve_reversals: boolean;
  user_id: string;
}

export const listRequests = (params: Record<string, string | number>) => requestsApi<RequestPage>(toQuery(params));
export const approveRequest = (id: string, comment: string) => requestsApi<CorrectionRequest>(`/${id}/approve`, send('POST', { comment: comment || null })).catch(needsConnection);
export const rejectRequest = (id: string, comment: string) => requestsApi<CorrectionRequest>(`/${id}/reject`, send('POST', { comment })).catch(needsConnection);
export const cancelRequest = (id: string) => requestsApi<CorrectionRequest>(`/${id}/cancel`, send('POST')).catch(needsConnection);
