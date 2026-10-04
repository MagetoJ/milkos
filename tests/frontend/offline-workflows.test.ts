// Farmers, collections, sensors and sessions through the same functions the screens call.
import { describe, expect, it } from 'vitest';
import { createFarmer, listFarmers } from '@/app/cooperatives/_api/coop-client';
import { listCollections, recordCollection, recordingOptions } from '@/app/collections/_api/collection-client';
import { ApiError } from '@/lib/api-client';
import { getBluetoothCapability, isBluetoothSupported } from '@/lib/bluetooth/capability';
import { decodeBatteryLevel, decodeTemperature } from '@/lib/bluetooth/protocols';
import { getConnectivity, probe, reportRequest, resetConnectivity } from '@/lib/offline/connectivity';
import { openUserDb, setMeta } from '@/lib/offline/db';
import { bootSession } from '@/lib/offline/auth';
import { checkOfflineSession, saveOfflineSession } from '@/lib/offline/session';
import { validateReading } from '@/lib/offline/validation';
import { saveReading } from '@/lib/sensors/reading-service';
import { SimulatedSensorAdapter } from '@/lib/sensors/simulated-adapter';
import { withMeta } from '@/lib/sync/apply';
import { syncEngine } from '@/lib/sync/engine';
import { installFakeServer, USER } from './fake-server';
import { withCleanState } from './helpers';

withCleanState();

const offlineSession = (overrides: Partial<{ expires_at: string }> = {}) => ({
  token: 'secret-1',
  issued_at: new Date().toISOString(),
  expires_at: overrides.expires_at ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
  device: { device_identifier: 'device-1' },
  user: USER,
  permissions: ['farmer.create', 'farmer.update', 'collection.create', 'cooler.read'],
});

/** A device that synced before and is now offline. */
async function offlineDevice() {
  await saveOfflineSession(offlineSession());
  const db = openUserDb(USER.id);
  await setMeta(db, 'initial_sync_done', true);
  await db.cooperative.put(withMeta('cooperative', { id: 'coop-1', name: 'Kiserian Dairy', code: 'K-1' }));
  await db.farmers.bulkPut([
    withMeta('farmer', { id: 'f-1', first_name: 'Jane', last_name: 'Wanjiku', full_name: 'Jane Wanjiku', farmer_number: 'F-0001', phone: '+254712345678', village: 'Kiserian', status: 'ACTIVE' }),
    withMeta('farmer', { id: 'f-2', first_name: 'Peter', last_name: 'Kamau', full_name: 'Peter Kamau', farmer_number: 'F-0002', phone: '+254722000111', village: 'Rongai', status: 'ACTIVE' }),
  ]);
  await db.coolers.put(withMeta('cooler', { id: 'k-1', name: 'Kiserian Main Cooler', code: 'CLR-001', status: 'ACTIVE', capacity_litres: 5000, is_operational: true }));
  resetConnectivity({ network: false, server: 'unreachable' });
  return db;
}

describe('offline farmers', () => {
  it('searches farmers from the local database (name, number, phone)', async () => {
    await offlineDevice();
    const byName = await listFarmers({ search: 'jane kiserian', page: 1, pageSize: 25 });
    expect(byName.items.map((f) => f.full_name)).toEqual(['Jane Wanjiku']);
    expect((await listFarmers({ search: '0722', page: 1, pageSize: 25 })).items[0].full_name).toBe('Peter Kamau');
    expect((await listFarmers({ search: 'F-0002', page: 1, pageSize: 25 })).total).toBe(1);
    expect((await listFarmers({ status: 'ACTIVE', page: 1, pageSize: 1 })).total).toBe(2);
  });

  it('creates a farmer offline: validated, saved, queued, shown as pending', async () => {
    const db = await offlineDevice();
    const farmer = await createFarmer({ first_name: 'Mary', last_name: 'Wanjiku', phone: '0733 111 222' });
    expect(farmer).toMatchObject({ full_name: 'Mary Wanjiku', phone: '+254733111222', sync_status: 'pending', farmer_number: 'Pending' });
    const [item] = await db.queue.toArray();
    expect(item).toMatchObject({ entity_type: 'farmer', operation: 'create', local_id: farmer.id, status: 'pending' });
    expect((await listFarmers({ search: 'mary', page: 1, pageSize: 25 })).items[0].sync_status).toBe('pending');

    await expect(createFarmer({ first_name: 'X', last_name: 'Y', phone: '123' })).rejects.toMatchObject({ status: 422 });
    try {
      await createFarmer({ first_name: '', last_name: 'Y', phone: '123' });
    } catch (e) {
      expect((e as ApiError).fields).toHaveProperty('phone');
      expect((e as ApiError).fields).toHaveProperty('first_name');
    }
  });

  it('online: the server answers right away and a duplicate goes back to the form', async () => {
    const server = installFakeServer();
    await saveOfflineSession(offlineSession());
    await setMeta(openUserDb(USER.id), 'initial_sync_done', true);
    reportRequest(true);
    await syncEngine.start(USER.id);
    const saved = await createFarmer({ first_name: 'Mary', last_name: 'W', phone: '0733111222' });
    expect(saved.sync_status).toBe('synced');
    expect(saved.farmer_number).toBe('F-0001');
    expect(server.pushes).toBeGreaterThan(0);

    await expect(createFarmer({ first_name: 'Other', last_name: 'W', phone: '0733111222' })).rejects.toMatchObject({ status: 409 });
    // The refused optimistic record was rolled back.
    expect((await listFarmers({ search: 'Other', page: 1, pageSize: 25 })).total).toBe(0);
    expect(await openUserDb(USER.id).queue.count()).toBe(0);
  });
});

describe('offline milk collections', () => {
  it('records a collection offline and lists it as pending', async () => {
    const db = await offlineDevice();
    const options = await recordingOptions('jane');
    expect(options.farmers).toEqual([{ id: 'f-1', label: 'Jane Wanjiku (F-0001)' }]);
    expect(options.coolers[0].label).toBe('Kiserian Main Cooler (CLR-001)');

    const collection = await recordCollection({ farmer_id: 'f-1', cooler_id: 'k-1', quantity_litres: 20, collection_date: '2026-10-04' });
    expect(collection).toMatchObject({ sync_status: 'pending', farmer_name: 'Jane Wanjiku', cooler_name: 'Kiserian Main Cooler' });
    const page = await listCollections({ page: 1, page_size: 25 });
    expect(page.items).toHaveLength(1);
    expect(page.summary.accepted_litres).toBe(20);
    expect(page.offline).toBe(true);
    expect(await db.queue.count()).toBe(1);

    await expect(recordCollection({ farmer_id: 'f-1', quantity_litres: 0 })).rejects.toMatchObject({ status: 422 });
  });

  it('a collection for an offline-created farmer waits for that farmer', async () => {
    const db = await offlineDevice();
    const farmer = await createFarmer({ first_name: 'New', last_name: 'Farmer', phone: '0744000111' });
    await recordCollection({ farmer_id: farmer.id, quantity_litres: 5 });
    const [first, second] = await db.queue.orderBy('seq').toArray();
    expect(second.depends_on).toEqual([first.mutation_id]);
  });
});

describe('sensor readings', () => {
  it('stores readings offline and collapses a resent measurement', async () => {
    const db = await offlineDevice();
    const binding = { cooler_id: 'k-1', sensor_id: null, cooler_capacity_litres: 5000, protocol: null, calibration: null };
    const raw = { volume_litres: 2438, temperature_celsius: 4.1, measured_at: '2026-10-04T07:42:00.000Z', measurement_id: 'evt-1' };
    const first = await saveReading(binding, raw, 'MANUAL');
    expect(first).toMatchObject({ duplicate: false, status: 'pending' });
    const again = await saveReading(binding, raw, 'MANUAL');
    expect(again.duplicate).toBe(true);
    expect(await db.readings.count()).toBe(1);
    expect(await db.queue.count()).toBe(1);
  });

  it('validates readings like the server', () => {
    expect(() => validateReading({ volume_litres: -1, measured_at: new Date().toISOString() }, 5000)).toThrow();
    expect(validateReading({ volume_litres: 9000, measured_at: new Date().toISOString() }, 5000)).toEqual(['above_capacity']);
    expect(() => validateReading({ measured_at: new Date().toISOString() }, 5000)).toThrow();
  });

  it('the simulator is clearly simulated', async () => {
    const sim = new SimulatedSensorAdapter(5000, 1000, () => 0.5);
    await sim.connect();
    const info = await sim.getDeviceInfo();
    expect(info.transport).toBe('SIMULATED');
    const reading = await sim.read();
    expect(reading.measurement_id).toMatch(/^sim-/);
  });

  it('decodes the standard Bluetooth battery and temperature characteristics', () => {
    expect(decodeBatteryLevel(new DataView(Uint8Array.of(87).buffer))).toEqual({ battery_percent: 87 });
    const t = new DataView(new ArrayBuffer(2));
    t.setInt16(0, 412, true);
    expect(decodeTemperature(t)).toEqual({ temperature_celsius: 4.12 });
    t.setInt16(0, -32768, true);
    expect(decodeTemperature(t)).toEqual({ temperature_celsius: null });
  });
});

describe('bluetooth capability', () => {
  it('detects Web Bluetooth only in a secure context with the API present', async () => {
    const withBt = { bluetooth: { requestDevice: () => undefined, getAvailability: async () => true } };
    expect(isBluetoothSupported(withBt, true)).toBe(true);
    expect(isBluetoothSupported(withBt, false)).toBe(false);
    expect(isBluetoothSupported({}, true)).toBe(false);
    expect(await getBluetoothCapability(withBt, true)).toEqual({ supported: true, available: true, reason: null });
    const off = await getBluetoothCapability({ bluetooth: { requestDevice: () => undefined, getAvailability: async () => false } }, true);
    expect(off.available).toBe(false);
    expect((await getBluetoothCapability({}, true)).reason).toMatch(/can’t connect/);
  });
});

describe('connectivity and offline sessions', () => {
  it('tells "no network" from "server unreachable"', async () => {
    const server = installFakeServer();
    expect(await probe()).toBe(true);
    expect(getConnectivity().server).toBe('reachable');
    server.reachable = false;
    expect(await probe()).toBe(false);
    expect(getConnectivity()).toMatchObject({ network: true, server: 'unreachable' });
    (navigator as { onLine: boolean }).onLine = false;
    expect(await probe()).toBe(false);
    expect(getConnectivity().network).toBe(false);
  });

  it('honours an offline session only until it expires, and not with the clock turned back', async () => {
    const record = await saveOfflineSession(offlineSession());
    expect(checkOfflineSession(record)).toEqual({ ok: true });
    expect(checkOfflineSession(record, Date.parse(record.expiresAt) + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(checkOfflineSession({ ...record, clockHighWater: Date.now() + 86_400_000 })).toEqual({ ok: false, reason: 'clock' });
    expect(checkOfflineSession(null)).toEqual({ ok: false, reason: 'missing' });
  });

  it('starts offline only for a user who signed in online before', async () => {
    const server = installFakeServer();
    server.reachable = false;
    expect(await bootSession(['COOP_ADMIN'])).toMatchObject({ mode: 'unreachable', reason: 'missing' });
    await saveOfflineSession(offlineSession());
    expect(await bootSession(['COOP_ADMIN'])).toMatchObject({ mode: 'offline' });
    expect(await bootSession(['SUPER_ADMIN'])).toMatchObject({ mode: 'wrong-role', role: 'COOP_ADMIN' });
    await saveOfflineSession(offlineSession({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(await bootSession(['COOP_ADMIN'])).toMatchObject({ mode: 'unreachable', reason: 'expired' });
  });
});
