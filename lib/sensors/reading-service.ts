// Turning a measurement into a stored cooler reading: validate, collapse duplicates, save locally and
// queue it for the server. Works with no connection at all; the reading is "pending" until it syncs.
import { userDb } from '@/lib/offline/db';
import { uuid } from '@/lib/offline/ids';
import { saveChange, type SaveOutcome } from '@/lib/offline/mutations';
import { validateReading } from '@/lib/offline/validation';
import type { CoolerSensorBinding, RawMeasurement, ReadingSource, SensorReading } from './types';

export interface StoredReading extends SensorReading {
  id: string;
  cooperative_id?: string;
  quality: string;
  quality_flags: string[];
  received_at: string | null;
  measurement_key: string;
  sync_status?: string;
}

export function normalize(binding: CoolerSensorBinding, raw: RawMeasurement, source: ReadingSource): SensorReading {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    cooler_id: binding.cooler_id,
    sensor_id: binding.sensor_id,
    volume_litres: num(raw.volume_litres),
    temperature_celsius: num(raw.temperature_celsius),
    battery_percent: num(raw.battery_percent) === null ? null : Math.round(raw.battery_percent as number),
    signal_strength: num(raw.signal_strength) === null ? null : Math.round(raw.signal_strength as number),
    // Always UTC with milliseconds, the form the server's duplicate key uses.
    measured_at: new Date(raw.measured_at ?? Date.now()).toISOString(),
    source,
    measurement_id: raw.measurement_id ?? null,
    sequence: raw.sequence ?? null,
  };
}

/** Same key the server uses (services/cooler_readings.measurement_key), so duplicates collapse locally too. */
export function measurementKey(r: SensorReading): string {
  const who = r.sensor_id ?? r.source.toLowerCase();
  if (r.measurement_id) return `m:${who}:${r.measurement_id}`;
  return `t:${who}:${r.measured_at.slice(0, 23)}:${r.sequence ?? ''}`;
}

/** Store one reading (or return the existing one if this measurement was already stored). */
export async function saveReading(
  binding: CoolerSensorBinding,
  raw: RawMeasurement,
  source: ReadingSource,
): Promise<SaveOutcome<StoredReading> & { duplicate: boolean }> {
  const reading = normalize(binding, raw, source);
  const flags = validateReading(reading, binding.cooler_capacity_litres);
  const key = measurementKey(reading);
  const db = userDb();
  // Local history is short (the sync window), so scanning one cooler's readings is cheap.
  const existing = await db.readings.where('cooler_id').equals(reading.cooler_id).filter((r) => r.measurement_key === key).first();
  if (existing) {
    return { record: existing as unknown as StoredReading, status: existing._status, duplicate: true };
  }
  const id = uuid();
  const payload = { ...reading };
  const optimistic = {
    id,
    ...reading,
    quality: flags.length ? 'SUSPICIOUS' : source === 'SIMULATED' ? 'SIMULATED' : 'VALID',
    quality_flags: flags.length ? flags : source === 'SIMULATED' ? ['simulated'] : [],
    received_at: null,
    measurement_key: key,
  };
  const outcome = await saveChange<StoredReading>({
    mutation: { entity_type: 'cooler_reading', operation: 'create', local_id: id, table: 'readings', payload },
    table: 'readings',
    entity: 'cooler_reading',
    optimistic,
  });
  return { ...outcome, duplicate: false };
}

/** Report that a registered sensor connected or dropped (the server may alert on a disconnect). */
export async function reportSensorEvent(sensorId: string, event: 'CONNECTED' | 'DISCONNECTED') {
  return saveChange({
    mutation: {
      entity_type: 'sensor_event',
      operation: 'create',
      local_id: uuid(),
      table: null,
      payload: { sensor_id: sensorId, event, occurred_at: new Date().toISOString() },
    },
    table: null,
    entity: 'sensor',
    optimistic: null,
  });
}
