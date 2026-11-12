import { v4 as uuidv4 } from 'uuid';
import { db, type LocalCollection } from './db';

export interface RecordMilkInput {
  farmer_id: string;
  farmer_name: string;
  member_number: string;
  weight_kg: number;
  grade: 'A' | 'B' | 'C';
  shift: 'MORNING' | 'EVENING';
}

export async function saveOfflineCollection(input: RecordMilkInput): Promise<LocalCollection> {
  const now = new Date().toISOString();
  const client_tx_id = uuidv4();

  const record: LocalCollection = {
    client_tx_id,
    ...input,
    collected_at: now,
    updated_at: now,
    sync_status: 'pending',
    receipt_printed: false,
  };

  await db.transaction('rw', db.collections, db.syncQueue, async () => {
    await db.collections.add(record);
    await db.syncQueue.add({
      client_tx_id,
      action: 'CREATE_COLLECTION',
      payload: record,
      status: 'pending',
      retry_count: 0,
      created_at: now,
    });
  });

  return record;
}

export async function updateOfflineCollection(
  client_tx_id: string,
  updates: Partial<Pick<LocalCollection, 'weight_kg' | 'grade' | 'shift'>>
): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction('rw', db.collections, db.syncQueue, async () => {
    const existing = await db.collections.get(client_tx_id);
    if (!existing) throw new Error('Collection record not found locally');

    const updated: LocalCollection = {
      ...existing,
      ...updates,
      updated_at: now,
      sync_status: 'pending',
    };

    await db.collections.put(updated);
    await db.syncQueue.add({
      client_tx_id,
      action: 'UPDATE_COLLECTION',
      payload: updated,
      status: 'pending',
      retry_count: 0,
      created_at: now,
    });
  });
}
