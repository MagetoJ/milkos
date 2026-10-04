// One write path for every change that may be made offline:
//
//   1. validate locally (same rules as the server where possible)
//   2. save the optimistic record + queue the mutation (one IndexedDB transaction)
//   3. if the server is reachable, push right away and wait briefly for its answer:
//        accepted  -> the record is replaced by the server's version ("synced")
//        refused   -> the optimistic change is rolled back and the error goes to the form, exactly as
//                     an online save would have behaved
//        no answer -> it stays queued ("pending"); the sync engine keeps trying
//   4. offline: return immediately with the record marked "pending"
import { ApiError } from '@/lib/api-client';
import { withMeta } from '@/lib/sync/apply';
import { syncEngine } from '@/lib/sync/engine';
import { discardItem, enqueue, type NewMutation } from '@/lib/sync/queue';
import { isServerReachable } from './connectivity';
import { userDb } from './db';
import { getDeviceId } from './device';
import { publicRow } from './repositories';
import type { LocalMeta, LocalTable, PulledEntity, RecordSyncStatus } from './types';

export interface SaveOutcome<T> {
  record: T;
  status: RecordSyncStatus;
}

export interface ChangeSpec {
  mutation: NewMutation;
  table: LocalTable | null;
  entity: PulledEntity;
  /** The record as it should look locally right away (without sync metadata). */
  optimistic: (Record<string, unknown> & { id: string }) | null;
  /** Keep the form open on a server refusal (true for interactive forms). */
  interactive?: boolean;
}

export async function saveChange<T>(spec: ChangeSpec): Promise<SaveOutcome<T>> {
  const db = userDb();
  const deviceId = await getDeviceId();
  let row: (Record<string, unknown> & { id: string }) | undefined;
  if (spec.table && spec.optimistic) {
    const existing = (await db.table(spec.table).get(spec.optimistic.id)) as (LocalMeta & Record<string, unknown>) | undefined;
    row = withMeta(spec.entity, spec.optimistic, 'pending', {
      _local_id: existing?._local_id ?? spec.optimistic.id,
      _server_id: existing?._server_id ?? null,
      _device_id: existing?._device_id ?? deviceId,
      _local_created_at: existing?._local_created_at,
      _last_synced_at: existing?._last_synced_at ?? null,
    });
  }
  const item = await enqueue(db, spec.mutation, row && spec.table ? { table: spec.table, row } : undefined);

  if (syncEngine.started && isServerReachable()) {
    const outcome = await syncEngine.flushItem(item.mutation_id);
    if (outcome === 'synced') {
      if (!spec.table || !row) return { record: {} as T, status: 'synced' };
      const localId = row.id;
      // Normally the same id; if the server allocated another, find the record by its client id.
      const fresh = ((await db.table(spec.table).get(localId)) ??
        (await db.table(spec.table).filter((r: Record<string, unknown>) => r._local_id === localId).first())) as
        | (LocalMeta & Record<string, unknown> & { id: string })
        | undefined;
      return { record: publicRow<T>((fresh ?? row) as never), status: fresh?._status ?? 'synced' };
    }
    if ((outcome === 'failed' || outcome === 'conflict') && spec.interactive) {
      const queued = await db.queue.where('mutation_id').equals(item.mutation_id).first();
      const error = queued?.last_error;
      await discardItem(db, item.mutation_id);
      throw new ApiError(outcome === 'conflict' ? 409 : 422, error?.message ?? 'The server refused this change.', error?.fields ?? {});
    }
    const current = spec.table && row ? await db.table(spec.table).get(row.id) : row;
    return { record: publicRow<T>((current ?? row ?? {}) as never), status: outcome === 'pending' ? 'pending' : outcome };
  }
  return { record: row ? publicRow<T>(row as never) : ({} as T), status: 'pending' };
}
