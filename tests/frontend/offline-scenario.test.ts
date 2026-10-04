// The offline day, end to end on the device side (backend side: backend/tests/test_sync.py
// test_offline_day_end_to_end). The sensor is the development simulator: a real Bluetooth sensor can't
// be driven from a test, and no manufacturer protocol exists yet.
import { describe, expect, it } from 'vitest';
import { listFarmers } from '@/app/cooperatives/_api/coop-client';
import { recordCollection } from '@/app/collections/_api/collection-client';
import { bootSession, provisionDevice } from '@/lib/offline/auth';
import { reportRequest } from '@/lib/offline/connectivity';
import { openUserDb } from '@/lib/offline/db';
import { latestReadingFor } from '@/lib/offline/repositories';
import { sensorManager } from '@/lib/sensors/manager';
import { SimulatedSensorAdapter } from '@/lib/sensors/simulated-adapter';
import { syncEngine } from '@/lib/sync/engine';
import { installFakeServer, USER } from './fake-server';
import { withCleanState } from './helpers';

withCleanState();

describe('offline day', () => {
  it('works offline and synchronises everything when the connection returns', async () => {
    const server = installFakeServer();
    server.put('farmer', { id: 'f-1', first_name: 'Jane', last_name: 'Wanjiku', full_name: 'Jane Wanjiku', farmer_number: 'F-0001', phone: '+254712345678', status: 'ACTIVE' });
    server.put('cooler', { id: 'k-1', name: 'Kiserian Main Cooler', code: 'CLR-001', status: 'ACTIVE', capacity_litres: 5000, low_volume_alert_litres: 3000 });

    // 1-2. Online login: the device gets its offline session and downloads the cooperative's data.
    expect(await provisionDevice()).not.toBeNull();
    const online = await bootSession(['COOP_ADMIN', 'MANAGER']);
    expect(online.mode).toBe('online');
    await syncEngine.start(USER.id);
    await syncEngine.syncNow({ force: true });
    expect(syncEngine.getState().initialSyncDone).toBe(true);

    // 3-6. Internet lost; MilkOS starts again and recognises the offline session.
    syncEngine.stop();
    server.reachable = false;
    const offline = await bootSession(['COOP_ADMIN', 'MANAGER']);
    expect(offline.mode).toBe('offline');
    await syncEngine.start(USER.id);

    // 7-8. Search a farmer: answered from IndexedDB.
    const found = await listFarmers({ search: 'jane', page: 1, pageSize: 25 });
    expect(found.items[0].id).toBe('f-1');

    // 9-11. Record a milk collection: shown immediately, pending sync.
    const collection = await recordCollection({ farmer_id: 'f-1', cooler_id: 'k-1', quantity_litres: 20 });
    expect(collection.sync_status).toBe('pending');

    // 12-15. Connect a (simulated) sensor; its reading is stored locally and shown on the dashboard.
    await sensorManager.connect(
      { cooler_id: 'k-1', sensor_id: null, cooler_capacity_litres: 5000, protocol: null, calibration: null },
      new SimulatedSensorAdapter(5000, 60_000, () => 0),
    );
    const stored = await sensorManager.readNow('k-1');
    expect(stored?.status).toBe('pending');
    const latest = await latestReadingFor<{ source: string; sync_status: string }>('k-1');
    expect(latest).toMatchObject({ source: 'SIMULATED', sync_status: 'pending' });
    await sensorManager.disconnect('k-1');

    const db = openUserDb(USER.id);
    expect(await db.queue.count()).toBe(2);
    expect(server.pushes).toBe(0);

    // 16-24. Internet returns: the engine pushes, the server stores, the device marks everything synced.
    server.reachable = true;
    reportRequest(true);
    await syncEngine.syncNow({ force: true });
    expect(server.pushes).toBeGreaterThan(0);
    expect(await db.queue.count()).toBe(0);
    expect((await db.collections.get(collection.id))?._status).toBe('synced');
    expect((await db.collections.get(collection.id))?.reference).toMatch(/^MC-/);
    expect(server.entities.has(`collection:${collection.id}`)).toBe(true);
    expect([...server.entities.keys()].some((k) => k.startsWith('cooler_reading:'))).toBe(true);
    // The cooler's server-side level came back with the pull.
    expect((await db.coolers.get('k-1'))?.current_volume_litres).toBe(stored?.record.volume_litres);
  });
});
