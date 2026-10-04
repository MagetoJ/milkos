import { describe, expect, it } from 'vitest';
import { openUserDb } from '@/lib/offline/db';
import { getConnectivity, reportRequest } from '@/lib/offline/connectivity';
import { applyPulled, withMeta } from '@/lib/sync/apply';
import { syncEngine } from '@/lib/sync/engine';
import { enqueue } from '@/lib/sync/queue';
import { installFakeServer, USER } from './fake-server';
import { withCleanState } from './helpers';

withCleanState();

async function queueFarmer(phone = '+254712345678', id = crypto.randomUUID()) {
  const db = openUserDb(USER.id);
  await enqueue(
    db,
    { entity_type: 'farmer', operation: 'create', local_id: id, table: 'farmers', payload: { first_name: 'Jane', last_name: 'W', phone } },
    { table: 'farmers', row: withMeta('farmer', { id, first_name: 'Jane', last_name: 'W', phone, farmer_number: 'Pending' }, 'pending') },
  );
  return id;
}

describe('sync engine', () => {
  it('pushes queued changes, marks records synced, and pulls server data', async () => {
    const server = installFakeServer();
    server.put('centre', { id: 'centre-1', name: 'Kiserian Centre', status: 'ACTIVE' });
    const id = await queueFarmer();
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();

    const db = openUserDb(USER.id);
    expect(await db.queue.count()).toBe(0);
    const farmer = await db.farmers.get(id);
    expect(farmer).toMatchObject({ _status: 'synced', farmer_number: 'F-0001', sync_version: 1 });
    expect(await db.centres.get('centre-1')).toBeTruthy();
    expect(syncEngine.getState()).toMatchObject({ phase: 'idle', initialSyncDone: true });
    expect(syncEngine.getState().lastSyncAt).not.toBeNull();
  });

  it('keeps changes queued while offline and sends them when the server returns', async () => {
    const server = installFakeServer();
    server.reachable = false;
    const id = await queueFarmer();
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    expect(syncEngine.getState().phase).toBe('offline');
    expect(getConnectivity().server).toBe('unreachable');
    expect((await openUserDb(USER.id).farmers.get(id))?._status).toBe('pending');

    server.reachable = true;
    reportRequest(true);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    expect((await openUserDb(USER.id).farmers.get(id))?._status).toBe('synced');
  });

  it('retries server errors with backoff and counts the attempt', async () => {
    const server = installFakeServer();
    server.failPushes = 1;
    await queueFarmer();
    await syncEngine.start(USER.id);
    await syncEngine.whenIdle();
    const [item] = await openUserDb(USER.id).queue.toArray();
    expect(item).toMatchObject({ status: 'pending', attempts: 1 });
    expect(item.next_attempt_at).toBeGreaterThan(Date.now());
    expect(item.last_error?.code).toBe('server');

    await openUserDb(USER.id).queue.toCollection().modify({ next_attempt_at: 0 });
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    expect(await openUserDb(USER.id).queue.count()).toBe(0);
  });

  it('never applies a resent mutation twice', async () => {
    const server = installFakeServer();
    await queueFarmer();
    const db = openUserDb(USER.id);
    const [item] = await db.queue.toArray();
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    // The response was "lost": the device sends the same mutation again.
    await db.queue.add({ ...item, seq: undefined, status: 'pending', next_attempt_at: 0 });
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    expect([...server.entities.keys()].filter((k) => k.startsWith('farmer:'))).toHaveLength(1);
    expect(await db.queue.count()).toBe(0);
  });

  it('marks a conflict for review instead of overwriting', async () => {
    const server = installFakeServer();
    server.put('farmer', { id: 'existing', first_name: 'Old', phone: '+254712345678', farmer_number: 'F-0001' });
    const id = await queueFarmer('+254712345678');
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    const db = openUserDb(USER.id);
    const [item] = await db.queue.toArray();
    expect(item.status).toBe('conflict');
    expect(item.last_error?.fields.phone).toBeTruthy();
    expect((await db.farmers.get(id))?._status).toBe('conflict');
    expect(syncEngine.getState().counts.conflict).toBe(1);
  });

  it('renews an expired access token with the device session', async () => {
    const server = installFakeServer();
    const { saveOfflineSession } = await import('@/lib/offline/session');
    await saveOfflineSession({
      token: 'secret-1', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      device: { device_identifier: 'd' }, user: USER, permissions: [],
    });
    server.expireToken = true;
    await queueFarmer();
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    await syncEngine.whenIdle();
    expect(server.calls).toContain('POST /api/v1/devices/session/refresh');
    expect(await openUserDb(USER.id).queue.count()).toBe(0);
  });

  it('a pull never overwrites a record with unsynced local changes', async () => {
    const db = openUserDb('u');
    await db.farmers.put(withMeta('farmer', { id: 'f1', first_name: 'Local edit' }, 'pending'));
    await applyPulled(db, [{ seq: 1, entity_type: 'farmer', entity_id: 'f1', op: 'upsert', data: { id: 'f1', first_name: 'Server' } }]);
    expect((await db.farmers.get('f1'))?.first_name).toBe('Local edit');
    await applyPulled(db, [{ seq: 2, entity_type: 'farmer', entity_id: 'f2', op: 'upsert', data: { id: 'f2', first_name: 'New' } }]);
    expect((await db.farmers.get('f2'))?._status).toBe('synced');
  });
});
