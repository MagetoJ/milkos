// Writing server data into the local database: pulled changes and the results of pushed mutations.
// A record with local changes still waiting to sync is never overwritten by a pull; its own push result
// replaces it once the server has it.
import { emitLocalChange } from '@/lib/offline/events';
import { nowIso } from '@/lib/offline/ids';
import type { UserDB } from '@/lib/offline/db';
import type { Local, LocalMeta, LocalTable, MutationEntity, PulledEntity, RecordSyncStatus } from '@/lib/offline/types';

export const TABLE_OF: Record<PulledEntity, LocalTable> = {
  cooperative: 'cooperative',
  farmer: 'farmers',
  centre: 'centres',
  cooler: 'coolers',
  collector: 'collectors',
  team_member: 'team',
  collection: 'collections',
  cooler_reading: 'readings',
  sensor: 'sensors',
  notification: 'notifications',
};

export const PULLED_OF_MUTATION: Record<MutationEntity, PulledEntity> = {
  farmer: 'farmer',
  centre: 'centre',
  collection: 'collection',
  cooler_reading: 'cooler_reading',
  sensor_event: 'sensor',
};

/** Fields that point at other records, rewritten if the server gave a record a different id. */
const REFERENCES: Partial<Record<LocalTable, string[]>> = {
  collections: ['farmer_id', 'cooler_id', 'collector_id', 'centre_id'],
  farmers: ['centre_id'],
  readings: ['cooler_id', 'sensor_id'],
};

export interface Change {
  seq: number;
  entity_type: PulledEntity;
  entity_id: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
}

export function withMeta(
  entity: PulledEntity,
  data: Record<string, unknown>,
  status: RecordSyncStatus = 'synced',
  extra: Partial<LocalMeta> = {},
): Local<Record<string, unknown>> & { id: string } {
  const now = nowIso();
  const id = String(data.id);
  return {
    ...data,
    id,
    _status: status,
    _entity: entity,
    _local_id: extra._local_id ?? id,
    _server_id: status === 'synced' ? id : (extra._server_id ?? null),
    _device_id: extra._device_id ?? null,
    _local_created_at: extra._local_created_at ?? now,
    _local_updated_at: now,
    _last_synced_at: status === 'synced' ? now : (extra._last_synced_at ?? null),
    _error: extra._error ?? null,
  };
}

const isUnsynced = (row: Record<string, unknown> | undefined) => !!row && row._status !== undefined && row._status !== 'synced';

export async function applyPulled(db: UserDB, changes: Change[]): Promise<number> {
  const touched = new Set<LocalTable>();
  let applied = 0;
  const tables = [...new Set(changes.map((c) => TABLE_OF[c.entity_type]).filter(Boolean))];
  if (tables.length === 0) return 0;
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const change of changes) {
      const tableName = TABLE_OF[change.entity_type];
      if (!tableName) continue;
      const table = db.table(tableName);
      const existing = (await table.get(change.entity_id)) as Record<string, unknown> | undefined;
      if (isUnsynced(existing)) continue;
      if (change.op === 'delete') {
        await table.delete(change.entity_id);
      } else if (change.data) {
        await table.put(withMeta(change.entity_type, change.data, 'synced', {
          _local_created_at: (existing?._local_created_at as string | undefined) ?? undefined,
          _device_id: (existing?._device_id as string | null | undefined) ?? null,
        }));
      }
      touched.add(tableName);
      applied += 1;
    }
  });
  if (touched.size) emitLocalChange(...touched);
  return applied;
}

/**
 * The server accepted a pushed change: store its version as synced. If the server used a different id
 * than the device (rare), move the record and repoint everything that referenced the device's id.
 */
export async function applyServerEntity(
  db: UserDB,
  table: LocalTable,
  entity: PulledEntity,
  localId: string,
  serverEntity: Record<string, unknown> | null,
  /** The mutation being applied (it is still queued at this point and must not count as a later edit). */
  mutationId?: string,
): Promise<void> {
  const tables = [db.table(table), db.queue, ...Object.keys(REFERENCES).map((t) => db.table(t))];
  await db.transaction('rw', tables, async () => {
    const local = (await db.table(table).get(localId)) as Record<string, unknown> | undefined;
    // Another queued edit of the same record is still waiting: keep the newer local version.
    const laterEdit = await db.queue.where('local_id').equals(localId).filter((q) => q.mutation_id !== mutationId).count();
    if (!serverEntity) {
      if (local && !laterEdit) await db.table(table).update(localId, { _status: 'synced', _last_synced_at: nowIso(), _error: null });
      return;
    }
    const serverId = String(serverEntity.id);
    if (serverId !== localId) {
      await db.table(table).delete(localId);
      for (const [refTable, fields] of Object.entries(REFERENCES)) {
        for (const field of fields) {
          // Rare (only when the server re-ids a record), so a scan is fine and works for unindexed fields.
          await db.table(refTable).filter((row: Record<string, unknown>) => row[field] === localId).modify({ [field]: serverId });
        }
      }
      await db.queue.filter((q) => q.local_id === localId || Object.values(q.payload).includes(localId)).modify((q) => {
        if (q.local_id === localId) q.local_id = serverId;
        for (const [k, v] of Object.entries(q.payload)) if (v === localId) q.payload[k] = serverId;
      });
    }
    if (laterEdit && local) return;
    await db.table(table).put(withMeta(entity, serverEntity, 'synced', {
      _local_id: localId,
      _local_created_at: (local?._local_created_at as string | undefined) ?? undefined,
      _device_id: (local?._device_id as string | null | undefined) ?? null,
    }));
  });
  emitLocalChange(table, 'queue');
}

export async function markRecord(
  db: UserDB,
  table: LocalTable | null,
  localId: string,
  status: RecordSyncStatus,
  error: string | null = null,
): Promise<void> {
  if (!table) return;
  await db.table(table).update(localId, { _status: status, _error: error });
  emitLocalChange(table);
}

/** Keep devices lean: drop synced history older than the sync window (unsynced records always stay). */
export async function pruneHistory(db: UserDB, window: { collection_days: number; reading_days: number; notification_days: number }) {
  const day = 86_400_000;
  const collectionsBefore = new Date(Date.now() - window.collection_days * day).toISOString().slice(0, 10);
  const readingsBefore = new Date(Date.now() - window.reading_days * day).toISOString();
  const notificationsBefore = new Date(Date.now() - window.notification_days * day).toISOString();
  await db.collections.where('collection_date').below(collectionsBefore).filter((r) => r._status === 'synced').delete();
  await db.readings.where('measured_at').below(readingsBefore).filter((r) => r._status === 'synced').delete();
  await db.notifications.where('created_at').below(notificationsBefore).filter((r) => r._status === 'synced').delete();
}
