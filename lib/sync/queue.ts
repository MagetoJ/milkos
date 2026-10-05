// The outbound queue. Every offline change is a QueueItem in IndexedDB, written in the same transaction
// as the optimistic local record, so it survives reloads, browser and device restarts. Items leave the
// queue only when the server has them (applied or duplicate) or when a person discards them.
//
//   pending --push--> syncing --applied/duplicate--> (removed; record marked synced)
//                        |--network / server error--> pending (retry with backoff)
//                        |--rejected (validation, permission)--> failed   (manual retry / edit / discard)
//                        '--conflict--> conflict                         (review)
import { emitLocalChange } from '@/lib/offline/events';
import { nowIso, uuid } from '@/lib/offline/ids';
import type { UserDB } from '@/lib/offline/db';
import type {
  LocalTable,
  MutationEntity,
  MutationError,
  MutationOperation,
  QueueItem,
  QueueStatus,
} from '@/lib/offline/types';

/** 5 s, 15 s, 45 s, 2 min, 7 min ... capped at 30 min, with jitter. */
export function backoffMs(attempts: number, random = Math.random): number {
  const base = Math.min(5_000 * 3 ** Math.max(0, attempts - 1), 30 * 60_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export interface NewMutation {
  entity_type: MutationEntity;
  operation: MutationOperation;
  local_id: string;
  table: LocalTable | null;
  payload: Record<string, unknown>;
  base_version?: number | null;
  base?: Record<string, unknown> | null;
  depends_on?: string[];
  previous?: Record<string, unknown> | null;
}

export function buildItem(m: NewMutation): QueueItem {
  const now = nowIso();
  return {
    mutation_id: uuid(),
    entity_type: m.entity_type,
    operation: m.operation,
    local_id: m.local_id,
    table: m.table,
    payload: m.payload,
    base_version: m.base_version ?? null,
    base: m.base ?? null,
    client_timestamp: now,
    depends_on: m.depends_on ?? [],
    status: 'pending',
    attempts: 0,
    next_attempt_at: 0,
    last_error: null,
    previous: m.previous ?? null,
    server_entity: null,
    created_at: now,
    updated_at: now,
  };
}

/** Queue a change together with its optimistic local record (one transaction: both or neither). */
export async function enqueue(
  db: UserDB,
  mutation: NewMutation,
  record?: { table: LocalTable; row: Record<string, unknown> & { id: string } },
): Promise<QueueItem> {
  const item = buildItem(mutation);
  const tables = record ? [db.queue, db.table(record.table)] : [db.queue];
  await db.transaction('rw', tables, async () => {
    if (record) await db.table(record.table).put(record.row);
    await db.queue.add(item);
  });
  emitLocalChange('queue', ...(record ? [record.table] : []));
  return item;
}

export async function queueCounts(db: UserDB): Promise<Record<QueueStatus, number>> {
  const counts: Record<QueueStatus, number> = { pending: 0, syncing: 0, failed: 0, conflict: 0 };
  await db.queue.each((item) => {
    counts[item.status] += 1;
  });
  return counts;
}

/** Mutations the local record `localId` is still waiting on (its own unsynced creates). */
export async function pendingMutationIdsFor(db: UserDB, localIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = localIds.filter((v): v is string => !!v);
  if (ids.length === 0) return [];
  const items = await db.queue.where('local_id').anyOf(ids).toArray();
  return items.filter((i) => i.operation === 'create').map((i) => i.mutation_id);
}

/** The next items to push, in order, skipping ones whose prerequisites haven't synced. */
export async function dueBatch(db: UserDB, now = Date.now(), limit = 50): Promise<QueueItem[]> {
  const all = await db.queue.orderBy('seq').toArray();
  const inQueue = new Set(all.map((i) => i.mutation_id));
  const out: QueueItem[] = [];
  const picked = new Set<string>();
  for (const item of all) {
    if (out.length >= limit) break;
    if (item.status !== 'pending' || item.next_attempt_at > now) continue;
    // A prerequisite still queued must be in this same batch, ahead of it.
    if (item.depends_on.some((dep) => inQueue.has(dep) && !picked.has(dep))) continue;
    out.push(item);
    picked.add(item.mutation_id);
  }
  return out;
}

export async function setStatus(db: UserDB, mutationIds: string[], status: QueueStatus): Promise<void> {
  await db.transaction('rw', db.queue, async () => {
    for (const id of mutationIds) {
      await db.queue.where('mutation_id').equals(id).modify({ status, updated_at: nowIso() });
    }
  });
  emitLocalChange('queue');
}

/**
 * A transient failure: back to pending. Server errors count as an attempt and wait out a backoff; a lost
 * connection doesn't (the engine waits for the server to come back instead).
 */
export async function deferItems(db: UserDB, mutationIds: string[], error: MutationError, countAttempt: boolean): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.queue, async () => {
    for (const id of mutationIds) {
      await db.queue.where('mutation_id').equals(id).modify((item) => {
        if (countAttempt) item.attempts += 1;
        item.status = 'pending';
        item.next_attempt_at = countAttempt ? now + backoffMs(Math.max(1, item.attempts)) : 0;
        item.last_error = error;
        item.updated_at = nowIso();
      });
    }
  });
  emitLocalChange('queue');
}

export async function settleItem(
  db: UserDB,
  mutationId: string,
  outcome: { status: 'failed' | 'conflict'; error: MutationError; server_entity?: Record<string, unknown> | null },
): Promise<void> {
  await db.queue.where('mutation_id').equals(mutationId).modify((item) => {
    item.status = outcome.status;
    item.attempts += 1;
    item.last_error = outcome.error;
    item.server_entity = outcome.server_entity ?? null;
    item.updated_at = nowIso();
  });
  emitLocalChange('queue');
}

export async function removeItem(db: UserDB, mutationId: string): Promise<void> {
  await db.queue.where('mutation_id').equals(mutationId).delete();
  emitLocalChange('queue');
}

/** Manual "Retry": failed items (and pending ones waiting out a backoff) go again now. */
export async function retryNow(db: UserDB, mutationIds?: string[]): Promise<number> {
  let n = 0;
  await db.queue
    .filter((item) => (mutationIds ? mutationIds.includes(item.mutation_id) : item.status === 'failed' || item.status === 'pending'))
    .modify((item) => {
      if (item.status === 'syncing') return;
      item.status = 'pending';
      item.next_attempt_at = 0;
      item.updated_at = nowIso();
      n += 1;
    });
  emitLocalChange('queue');
  return n;
}

/**
 * Drop a change that will never sync as it is, restoring the local data: an unsynced create disappears,
 * an update goes back to the last known server state. Dependent changes are dropped with it.
 */
export async function discardItem(db: UserDB, mutationId: string): Promise<QueueItem[]> {
  const dropped: QueueItem[] = [];
  const tables = new Set<LocalTable>();
  await db.transaction('rw', [db.queue, db.farmers, db.centres, db.collections, db.batches, db.readings], async () => {
    const queue = [mutationId];
    while (queue.length) {
      const id = queue.shift()!;
      const item = await db.queue.where('mutation_id').equals(id).first();
      if (!item) continue;
      dropped.push(item);
      await db.queue.where('mutation_id').equals(id).delete();
      if (item.table) {
        tables.add(item.table);
        const table = db.table(item.table);
        if (item.operation === 'create') await table.delete(item.local_id);
        else if (item.previous) await table.put(item.server_entity ? { ...item.previous, ...item.server_entity, _status: 'synced' } : item.previous);
      }
      const dependents = await db.queue.filter((q) => q.depends_on.includes(id)).toArray();
      queue.push(...dependents.map((d) => d.mutation_id));
    }
  });
  emitLocalChange('queue', ...tables);
  return dropped;
}

export async function listQueue(db: UserDB): Promise<QueueItem[]> {
  return db.queue.orderBy('seq').toArray();
}
