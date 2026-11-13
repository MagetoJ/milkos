import { v4 as uuidv4 } from 'uuid';
import { userDb, type LocalCollection } from './db';

export interface RecordMilkInput {
  farmer_id: string;
  farmer_name: string;
  member_number: string;
  weight_kg: number;
  grade: 'A' | 'B' | 'C';
  shift: 'MORNING' | 'EVENING';
}

export async function saveOfflineCollection(input: RecordMilkInput): Promise<LocalCollection> {
  const db = userDb();
  const now = new Date().toISOString();
  const client_tx_id = uuidv4();

  const record: LocalCollection = {
    id: client_tx_id,
    client_tx_id,
    ...input,
    collected_at: now,
    updated_at: now,
    sync_status: 'pending',
    receipt_printed: false,
    _status: 'pending',
    _entity: 'collection',
    _local_id: client_tx_id,
    _server_id: null,
    _device_id: null,
    _local_created_at: now,
    _local_updated_at: now,
    _last_synced_at: null,
    _error: null,
  };

  await db.transaction('rw', db.collections, db.queue, async () => {
    await db.collections.add(record);
    await db.queue.add({
      mutation_id: client_tx_id,
      entity_type: 'collection',
      operation: 'create',
      local_id: record.id,
      table: 'collections',
      base_version: null,
      base: null,
      payload: record,
      client_timestamp: now,
      depends_on: [],
      status: 'pending',
      attempts: 0,
      next_attempt_at: Date.now(),
      last_error: null,
      previous: null,
      server_entity: null,
      created_at: now,
      updated_at: now,
    });
  });

  return record;
}

export async function updateOfflineCollection(
  client_tx_id: string,
  updates: Partial<Pick<LocalCollection, 'weight_kg' | 'grade' | 'shift'>>
): Promise<void> {
  const db = userDb();
  const now = new Date().toISOString();

  await db.transaction('rw', db.collections, db.queue, async () => {
    const existing = (await db.collections.get(client_tx_id)) as LocalCollection | undefined;
    if (!existing) throw new Error('Collection record not found locally');

    const updated: LocalCollection = {
      ...existing,
      ...updates,
      updated_at: now,
      sync_status: 'pending',
      _status: 'pending',
      _entity: 'collection',
      _local_id: existing._local_id ?? client_tx_id,
      _server_id: existing._server_id ?? null,
      _device_id: existing._device_id ?? null,
      _local_updated_at: now,
      _last_synced_at: existing._last_synced_at ?? null,
      _error: null,
    };

    await db.collections.put(updated);
    await db.queue.add({
      mutation_id: client_tx_id,
      entity_type: 'collection',
      operation: 'update',
      local_id: updated.id,
      table: 'collections',
      base_version: null,
      base: null,
      payload: updated,
      client_timestamp: now,
      depends_on: [],
      status: 'pending',
      attempts: 0,
      next_attempt_at: Date.now(),
      last_error: null,
      previous: null,
      server_entity: null,
      created_at: now,
      updated_at: now,
    });
  });
}
