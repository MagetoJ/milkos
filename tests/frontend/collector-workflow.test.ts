// The collector workflow: allocation rules, the scale abstraction, the draft state machine, offline
// confirmation through the sync queue, sync results and the SMS receipt wording.
import { describe, expect, it } from 'vitest';
import { confirmBlockers, fillRemaining, parseKg, summarize, type AllocationLine } from '@/lib/collections/allocation';
import { blockers, canGo, newDraft, reduceDraft, type CollectionDraft } from '@/lib/collections/draft';
import { receiptLabel, receiptSummary } from '@/lib/collections/receipts';
import { batchPayload, confirmBatch, listBatches, todayStats } from '@/lib/collections/batch-client';
import { MockScaleAdapter } from '@/lib/scale/mock-adapter';
import { StabilityDetector } from '@/lib/scale/stability';
import { ScaleNotStableError } from '@/lib/scale/types';
import { openUserDb, setMeta } from '@/lib/offline/db';
import { reportRequest, resetConnectivity } from '@/lib/offline/connectivity';
import { saveOfflineSession } from '@/lib/offline/session';
import { withMeta } from '@/lib/sync/apply';
import { syncEngine } from '@/lib/sync/engine';
import { installFakeServer, USER } from './fake-server';
import { tick, withCleanState } from './helpers';

withCleanState();

const line = (id: string, kg: string, farmer = id): AllocationLine => ({
  line_id: `l-${id}`, farmer_id: farmer, farmer_name: `Farmer ${farmer}`, farmer_number: `F-${farmer}`, quantity_kg: kg,
});

describe('allocation arithmetic', () => {
  it('reports total, allocated and remaining with the right state', () => {
    const s = summarize(248.5, [line('a', '80'), line('b', '65'), line('c', '50')]);
    expect(s).toMatchObject({ totalCents: 24850, allocatedCents: 19500, remainingCents: 5350, state: 'remaining' });
    expect(summarize(248.5, [line('a', '248.50')]).state).toBe('valid');
    expect(summarize(248.5, [line('a', '200'), line('b', '60')]).state).toBe('over');
    expect(summarize(248.5, []).state).toBe('empty');
  });

  it('adds in hundredths, so float rounding never blocks or allows the wrong thing', () => {
    expect(summarize(0.3, [line('a', '0.1'), line('b', '0.2')]).state).toBe('valid');
    expect(summarize(100, [line('a', '33.33'), line('b', '33.33'), line('c', '33.34')]).remainingCents).toBe(0);
    expect(summarize(100, [line('a', '100.01')]).state).toBe('over');
  });

  it('parses KG strictly: positive, at most 2 decimals, comma accepted', () => {
    expect(parseKg('12.5')).toBe(12.5);
    expect(parseKg('12,75')).toBe(12.75);
    expect(parseKg('0')).toBeNull();
    expect(parseKg('-3')).toBeNull();
    expect(parseKg('1.234')).toBeNull();
    expect(parseKg('abc')).toBeNull();
  });

  it('blocks confirmation for every missing or invalid piece', () => {
    const ok = { totalKg: 100, lines: [line('a', '60'), line('b', '40')], coolerId: 'k-1', weightSource: 'SCALE' };
    expect(confirmBlockers(ok)).toEqual([]);
    // Exact allocation: under-allocation blocks too (the server refuses it as well).
    expect(confirmBlockers({ ...ok, lines: [line('a', '60')] }).join(' ')).toMatch(/40\.00 KG is not allocated/);
    expect(confirmBlockers({ ...ok, lines: [line('a', '99.99')] }).join(' ')).toMatch(/0\.01 KG is not allocated/);
    expect(confirmBlockers({ ...ok, coolerId: null })).toContain('Choose the cooler.');
    expect(confirmBlockers({ ...ok, totalKg: null })).toContain('Capture the total weight.');
    expect(confirmBlockers({ ...ok, lines: [] })).toContain('Add at least one farmer.');
    expect(confirmBlockers({ ...ok, lines: [line('a', '120')] }).join(' ')).toMatch(/more than the total/);
    expect(confirmBlockers({ ...ok, lines: [line('a', '')] }).join(' ')).toMatch(/Enter a KG amount/);
    expect(confirmBlockers({ ...ok, lines: [line('a', '10', 'x'), line('b', '10', 'x')] })).toContain('Each farmer can appear only once.');
  });

  it('fills the remaining weight onto one line', () => {
    const lines = fillRemaining(248.5, [line('a', '200'), line('b', '')], 'l-b');
    expect(lines[1].quantity_kg).toBe('48.50');
  });
});

describe('scale abstraction', () => {
  it('detects a stable weight only after consecutive close readings', () => {
    const d = new StabilityDetector({ windowMs: 1000, toleranceKg: 0.05, minSamples: 3 });
    expect(d.push(10, 0)).toBe(false);
    expect(d.push(10.02, 100)).toBe(false);
    expect(d.push(10.01, 200)).toBe(true);
    expect(d.push(12, 300)).toBe(false); // a swing
    expect(new StabilityDetector().push(0, 0)).toBe(false);
  });

  it('the mock scale settles, captures only stable weights and tares', async () => {
    let now = 0;
    const scale = new MockScaleAdapter({ intervalMs: 0, initialLoadKg: 0, random: () => 0.5, now: () => (now += 200) });
    await expect(scale.capture()).rejects.toThrow(/not connected/);
    await scale.connect();
    expect(scale.getStatus()).toMatchObject({ state: 'connected', transport: 'SIMULATED', deviceName: 'Scale simulator (development)', batteryPercent: 92 });
    scale.placeLoad(48.5);
    const first = await scale.tick();
    expect(first.stable).toBe(false);
    await expect(scale.capture()).rejects.toBeInstanceOf(ScaleNotStableError);
    for (let i = 0; i < 20; i++) await scale.tick();
    const captured = await scale.capture();
    expect(captured).toMatchObject({ kg: 48.5, stable: true });
    await scale.tare();
    for (let i = 0; i < 5; i++) await scale.tick();
    expect((await scale.getWeight()).kg).toBe(0);
    await scale.disconnect();
    expect(scale.getStatus().state).toBe('disconnected');
  });
});

describe('collection draft state machine', () => {
  const cooler = { id: 'k-1', name: 'Kiserian Cooler', code: 'CLR-001', centre_id: 'c-1', centre_name: 'Kiserian Centre' };
  const farmer = (id: string) => ({ id, full_name: `Farmer ${id}`, farmer_number: `F-${id}`, phone: null });

  it('moves DRAFT -> CAPTURED -> ALLOCATING -> CONFIRMED and never edits a confirmed draft', () => {
    let d = newDraft();
    expect(d).toMatchObject({ status: 'DRAFT', step: 'cooler' });
    expect(canGo(d, 'weight')).toBe(false);
    d = reduceDraft(d, { type: 'select_cooler', cooler });
    d = reduceDraft(d, { type: 'use_scale', scale: null });
    expect(d.step).toBe('weight');
    expect(canGo(d, 'allocate')).toBe(false);
    d = reduceDraft(d, { type: 'capture', weight: { kg: 100, source: 'MANUAL', tare_kg: null, captured_at: 'now' } });
    expect(d).toMatchObject({ status: 'CAPTURED', step: 'allocate' });
    d = reduceDraft(d, { type: 'add_farmer', farmer: farmer('a'), quantity_kg: '100' });
    d = reduceDraft(d, { type: 'add_farmer', farmer: farmer('a'), quantity_kg: '10' }); // same farmer again: ignored
    expect(d.lines).toHaveLength(1);
    expect(d.status).toBe('ALLOCATING');
    expect(blockers(d)).toEqual([]);
    const id = d.id;
    d = reduceDraft(d, { type: 'confirmed', result: { id } });
    expect(d).toMatchObject({ status: 'CONFIRMED', step: 'done' });
    expect(reduceDraft(d, { type: 'set_kg', line_id: d.lines[0].line_id, quantity_kg: '1' })).toBe(d);
    expect(reduceDraft(d, { type: 'reset' }).id).not.toBe(id);
  });
});

describe('SMS receipt wording', () => {
  it('never says sent unless the provider accepted it', () => {
    expect(receiptLabel(null, 'pending').label).toBe('Queued');
    expect(receiptLabel('SENT', 'pending').label).toBe('Queued'); // still on the device
    expect(receiptLabel('PENDING_PROVIDER', 'synced').label).toBe('Waiting for SMS provider');
    expect(receiptLabel('FAILED', 'synced').label).toBe('SMS failed');
    expect(receiptLabel('REFUNDED', 'synced').label).toBe('SMS not sent');
    expect(receiptLabel('SENT', 'synced').label).toBe('SMS sent');
    expect(receiptLabel(null, 'synced', false).label).toBe('No SMS');
    expect(receiptSummary(['SENT', 'PENDING_PROVIDER', 'FAILED'], 'synced')).toBe('1 of 3 SMS sent · 1 waiting · 1 failed');
    expect(receiptSummary(['SENT'], 'pending')).toMatch(/queued/);
  });
});

// ---------------- offline confirmation through the sync queue ----------------

const offlineSession = () => ({
  token: 'secret-1',
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  device: { device_identifier: 'device-1' },
  user: { ...USER, role: 'COLLECTOR' as const },
  permissions: ['collection.create', 'farmer.read', 'cooler.read'],
});

async function collectorDevice() {
  await saveOfflineSession(offlineSession());
  const db = openUserDb(USER.id);
  await setMeta(db, 'initial_sync_done', true);
  await db.farmers.bulkPut([
    withMeta('farmer', { id: 'f-1', first_name: 'Jane', last_name: 'W', full_name: 'Jane W', farmer_number: 'F-0001', phone: '+254712345678', status: 'ACTIVE' }),
    withMeta('farmer', { id: 'f-2', first_name: 'Peter', last_name: 'K', full_name: 'Peter K', farmer_number: 'F-0002', phone: '+254722000111', status: 'ACTIVE' }),
  ]);
  await db.coolers.put(withMeta('cooler', { id: 'k-1', name: 'Kiserian Cooler', code: 'CLR-001', status: 'ACTIVE', is_operational: true }));
  return db;
}

function readyDraft(): CollectionDraft {
  let d = newDraft({ id: 'k-1', name: 'Kiserian Cooler', code: 'CLR-001', centre_id: null, centre_name: null });
  d = reduceDraft(d, { type: 'use_scale', scale: null });
  d = reduceDraft(d, { type: 'capture', weight: { kg: 145, source: 'MANUAL', tare_kg: null, captured_at: new Date().toISOString() } });
  d = reduceDraft(d, { type: 'add_farmer', farmer: { id: 'f-1', full_name: 'Jane W', farmer_number: 'F-0001' }, quantity_kg: '80' });
  d = reduceDraft(d, { type: 'add_farmer', farmer: { id: 'f-2', full_name: 'Peter K', farmer_number: 'F-0002' }, quantity_kg: '65' });
  return d;
}

describe('offline collection', () => {
  it('builds a payload that never presents a manual weight as a scale reading', () => {
    const d = readyDraft();
    const p = batchPayload({ ...d, scale: { key: 'x', name: 'Some scale', identifier: 'abc', transport: 'BLUETOOTH_LE' } });
    expect(p).toMatchObject({ weight_source: 'MANUAL', scale_name: null, scale_identifier: null, captured_weight_kg: 145 });
    expect(p.allocations).toEqual([
      { id: d.lines[0].line_id, farmer_id: 'f-1', quantity_kg: 80 },
      { id: d.lines[1].line_id, farmer_id: 'f-2', quantity_kg: 65 },
    ]);
  });

  it('saves the batch and its allocations on the device and queues it once', async () => {
    const db = await collectorDevice();
    resetConnectivity({ network: false, server: 'unreachable' });
    const d = readyDraft();
    const first = await confirmBatch(d);
    expect(first.status).toBe('pending');
    expect(first.batch).toMatchObject({ id: d.id, reference: 'Pending sync', allocated_weight_kg: 145, remaining_weight_kg: 0, farmer_count: 2 });
    // A second tap on Confirm (or a reload) never queues the same collection twice.
    const again = await confirmBatch(d);
    expect(again.batch.id).toBe(d.id);
    const queue = await db.queue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ entity_type: 'collection_batch', operation: 'create', local_id: d.id, status: 'pending' });
    const list = await listBatches();
    expect(list.items[0].sync_status).toBe('pending');
    expect(await todayStats()).toMatchObject({ kg: 145, batches: 1, farmers: 2, pending: 1 });
  });

  it('refuses an over-allocated batch before it reaches the queue', async () => {
    const db = await collectorDevice();
    resetConnectivity({ network: false, server: 'unreachable' });
    const d = reduceDraft(readyDraft(), { type: 'set_kg', line_id: readyDraft().lines[0].line_id, quantity_kg: '80' });
    const over = { ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, quantity_kg: '200' } : l)) };
    await expect(confirmBatch(over)).rejects.toMatchObject({ status: 422 });
    expect(await db.queue.count()).toBe(0);
  });

  it('syncs when the connection returns: the server version replaces the pending one, idempotently', async () => {
    const server = installFakeServer();
    server.put('farmer', { id: 'f-1', full_name: 'Jane W', farmer_number: 'F-0001', status: 'ACTIVE' });
    server.put('farmer', { id: 'f-2', full_name: 'Peter K', farmer_number: 'F-0002', status: 'ACTIVE' });
    const db = await collectorDevice();
    resetConnectivity({ network: false, server: 'unreachable' });
    const d = readyDraft();
    await confirmBatch(d);
    server.reachable = true;
    reportRequest(true);
    await syncEngine.start(USER.id);
    await syncEngine.whenIdle();
    await tick(20);
    await syncEngine.whenIdle();
    expect(await db.queue.count()).toBe(0);
    const row = await db.batches.get(d.id);
    expect(row).toMatchObject({ _status: 'synced', reference: `CB-${d.id.slice(0, 6).toUpperCase()}`, status: 'CONFIRMED' });
    // Receipts were not sent by anyone: no provider -> waiting, never "sent".
    expect((row!.lines as { receipt_status: string }[]).map((l) => l.receipt_status)).toEqual(['PENDING_PROVIDER', 'PENDING_PROVIDER']);
    expect([...server.entities.keys()].filter((k) => k.startsWith('collection_batch:'))).toHaveLength(1);
  });
});
