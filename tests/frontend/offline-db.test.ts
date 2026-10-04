import { describe, expect, it } from 'vitest';
import { closeUserDb, metaDb, openUserDb, resetDatabasesForTests, userDbName } from '@/lib/offline/db';
import { getDeviceId, resetDeviceIdCache } from '@/lib/offline/device';
import { buildItem, backoffMs, dueBatch, discardItem, enqueue, queueCounts, retryNow } from '@/lib/sync/queue';
import { withMeta } from '@/lib/sync/apply';
import Dexie from 'dexie';
import { withCleanState } from './helpers';

withCleanState();

describe('offline database', () => {
  it('creates a per-user database with every operational table', async () => {
    const db = openUserDb('user-a');
    await db.open();
    expect(db.name).toBe(userDbName('user-a'));
    const tables = db.tables.map((t) => t.name).sort();
    expect(tables).toEqual(
      ['centres', 'collections', 'collectors', 'cooperative', 'coolers', 'farmers', 'meta', 'notifications', 'queue', 'readings', 'sensors', 'team'].sort(),
    );
    // Another user's data lives in another database.
    const other = openUserDb('user-b');
    await other.farmers.put(withMeta('farmer', { id: 'f1', last_name: 'X' }));
    expect(await openUserDb('user-a').farmers.count()).toBe(0);
  });

  it('keeps a stable random device id', async () => {
    const first = await getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    resetDeviceIdCache();
    expect(await getDeviceId()).toBe(first);
    expect(await metaDb().kv.get('device_id')).toBeTruthy();
  });
});

describe('sync queue', () => {
  it('writes the record and its queue item together, and both survive a restart', async () => {
    let db = openUserDb('u');
    await enqueue(
      db,
      { entity_type: 'farmer', operation: 'create', local_id: 'f1', table: 'farmers', payload: { first_name: 'Jane' } },
      { table: 'farmers', row: withMeta('farmer', { id: 'f1', first_name: 'Jane', last_name: 'W' }, 'pending') },
    );
    await closeUserDb(); // "browser restart"
    db = openUserDb('u');
    expect((await db.farmers.get('f1'))?._status).toBe('pending');
    const [item] = await db.queue.toArray();
    expect(item).toMatchObject({ entity_type: 'farmer', local_id: 'f1', status: 'pending', attempts: 0 });
    expect(await queueCounts(db)).toEqual({ pending: 1, syncing: 0, failed: 0, conflict: 0 });
  });

  it('holds back mutations whose prerequisite is not in the batch', async () => {
    const db = openUserDb('u');
    const farmer = await enqueue(db, { entity_type: 'farmer', operation: 'create', local_id: 'f1', table: null, payload: {} });
    await enqueue(db, { entity_type: 'collection', operation: 'create', local_id: 'c1', table: null, payload: {}, depends_on: [farmer.mutation_id] });
    expect((await dueBatch(db)).map((i) => i.local_id)).toEqual(['f1', 'c1']); // same batch, parent first
    // Parent waiting on a backoff: the child waits too.
    await db.queue.where('mutation_id').equals(farmer.mutation_id).modify({ next_attempt_at: Date.now() + 60_000 });
    expect(await dueBatch(db)).toEqual([]);
    await retryNow(db);
    expect((await dueBatch(db)).length).toBe(2);
  });

  it('backs off exponentially and caps the wait', () => {
    const fixed = () => 0.5;
    const waits = [1, 2, 3, 4, 5, 20].map((n) => backoffMs(n, fixed));
    expect(waits.slice(0, 5)).toEqual([5_000, 15_000, 45_000, 135_000, 405_000]);
    expect(waits[5]).toBe(30 * 60_000);
  });

  it('discarding a create removes the local record and its dependents', async () => {
    const db = openUserDb('u');
    const farmer = await enqueue(
      db,
      { entity_type: 'farmer', operation: 'create', local_id: 'f1', table: 'farmers', payload: {} },
      { table: 'farmers', row: withMeta('farmer', { id: 'f1' }, 'pending') },
    );
    await enqueue(
      db,
      { entity_type: 'collection', operation: 'create', local_id: 'c1', table: 'collections', payload: {}, depends_on: [farmer.mutation_id] },
      { table: 'collections', row: withMeta('collection', { id: 'c1', collection_date: '2026-10-04' }, 'pending') },
    );
    const dropped = await discardItem(db, farmer.mutation_id);
    expect(dropped.map((d) => d.local_id)).toEqual(['f1', 'c1']);
    expect(await db.farmers.count()).toBe(0);
    expect(await db.collections.count()).toBe(0);
    expect(await db.queue.count()).toBe(0);
  });

  it('builds unique client mutation ids', () => {
    const a = buildItem({ entity_type: 'farmer', operation: 'create', local_id: 'x', table: null, payload: {} });
    const b = buildItem({ entity_type: 'farmer', operation: 'create', local_id: 'x', table: null, payload: {} });
    expect(a.mutation_id).not.toBe(b.mutation_id);
  });
});

describe('reset', () => {
  it('removes every database', async () => {
    await openUserDb('u').open();
    await resetDatabasesForTests();
    expect(await Dexie.getDatabaseNames()).toEqual([]);
  });
});
