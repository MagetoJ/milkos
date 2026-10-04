// Live sensor connections in this browser tab, one per cooler. Works with any SensorAdapter; it never
// touches navigator.bluetooth itself. Readings go through reading-service (offline-safe).
import { reportSensorEvent, saveReading } from './reading-service';
import { SOURCE_OF_TRANSPORT, type ConnectionState, type CoolerSensorBinding, type RawMeasurement, type SensorAdapter, type SensorDeviceInfo } from './types';

export interface LiveSensor {
  coolerId: string;
  state: ConnectionState;
  transport: SensorAdapter['transport'];
  info: SensorDeviceInfo | null;
  lastReadingAt: string | null;
  error: string | null;
}

type Listener = () => void;

interface Entry {
  adapter: SensorAdapter;
  binding: CoolerSensorBinding;
  live: LiveSensor;
  unsubscribe: (() => void) | null;
  manualDisconnect: boolean;
}

class SensorManager {
  private entries = new Map<string, Entry>();
  private listeners = new Set<Listener>();
  private snapshot: Record<string, LiveSensor> = {};

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = Object.fromEntries([...this.entries].map(([k, e]) => [k, { ...e.live }]));
    this.listeners.forEach((l) => l());
  }

  private update(coolerId: string, patch: Partial<LiveSensor>) {
    const entry = this.entries.get(coolerId);
    if (!entry) return;
    entry.live = { ...entry.live, ...patch };
    this.emit();
  }

  async connect(binding: CoolerSensorBinding, adapter: SensorAdapter): Promise<SensorDeviceInfo> {
    await this.disconnect(binding.cooler_id);
    const entry: Entry = {
      adapter,
      binding,
      unsubscribe: null,
      manualDisconnect: false,
      live: { coolerId: binding.cooler_id, state: 'connecting', transport: adapter.transport, info: null, lastReadingAt: null, error: null },
    };
    this.entries.set(binding.cooler_id, entry);
    this.emit();
    try {
      await adapter.connect();
      const info = await adapter.getDeviceInfo();
      adapter.onDisconnect(() => {
        entry.unsubscribe?.();
        this.update(binding.cooler_id, { state: 'disconnected' });
        console.info('[milkos.sensors] sensor disconnected', { cooler: binding.cooler_id, manual: entry.manualDisconnect });
        if (!entry.manualDisconnect && binding.sensor_id && adapter.transport !== 'SIMULATED') {
          void reportSensorEvent(binding.sensor_id, 'DISCONNECTED').catch(() => undefined);
        }
      });
      if (adapter.subscribe) entry.unsubscribe = await adapter.subscribe((m) => void this.store(binding.cooler_id, m));
      this.update(binding.cooler_id, { state: 'connected', info });
      console.info('[milkos.sensors] sensor connected', { cooler: binding.cooler_id, transport: adapter.transport });
      if (binding.sensor_id && adapter.transport !== 'SIMULATED') void reportSensorEvent(binding.sensor_id, 'CONNECTED').catch(() => undefined);
      return info;
    } catch (error) {
      this.update(binding.cooler_id, { state: 'error', error: error instanceof Error ? error.message : 'Could not connect.' });
      throw error;
    }
  }

  async readNow(coolerId: string) {
    const entry = this.entries.get(coolerId);
    if (!entry || !entry.adapter.isConnected()) throw new Error('The sensor is not connected.');
    return this.store(coolerId, await entry.adapter.read());
  }

  private async store(coolerId: string, measurement: RawMeasurement) {
    const entry = this.entries.get(coolerId);
    if (!entry) return null;
    const hasValue = [measurement.volume_litres, measurement.temperature_celsius, measurement.battery_percent].some((v) => typeof v === 'number');
    if (!hasValue) return null; // nothing decodable (e.g. no protocol for this hardware yet)
    try {
      const result = await saveReading(entry.binding, measurement, SOURCE_OF_TRANSPORT[entry.adapter.transport]);
      this.update(coolerId, { lastReadingAt: result.record.measured_at, error: null });
      return result;
    } catch (error) {
      console.warn('[milkos.sensors] sensor reading rejected', { cooler: coolerId });
      this.update(coolerId, { error: error instanceof Error ? error.message : 'Invalid reading.' });
      return null;
    }
  }

  async disconnect(coolerId: string) {
    const entry = this.entries.get(coolerId);
    if (!entry) return;
    entry.manualDisconnect = true;
    entry.unsubscribe?.();
    await entry.adapter.disconnect().catch(() => undefined);
    this.entries.delete(coolerId);
    this.emit();
  }
}

export const sensorManager = new SensorManager();
