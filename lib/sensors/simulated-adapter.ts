// DEVELOPMENT SIMULATOR. Produces made-up readings so the cooler screens and the sync path can be
// exercised without hardware. Every reading it produces is stored with source SIMULATED, shown as
// "Simulated" in the UI, and never triggers an SMS on the server. It is not offered in production builds
// unless NEXT_PUBLIC_SENSOR_SIMULATOR=1.
import type { RawMeasurement, SensorAdapter, SensorDeviceInfo } from './types';

export function simulatorEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SENSOR_SIMULATOR === '1';
}

export class SimulatedSensorAdapter implements SensorAdapter {
  readonly transport = 'SIMULATED' as const;
  private connected = false;
  private level: number;
  private seq = 0;
  private callbacks: (() => void)[] = [];

  constructor(private capacityLitres: number | null, private intervalMs = 5000, private random = Math.random) {
    this.level = (capacityLitres ?? 5000) * 0.4;
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
    this.callbacks.forEach((cb) => cb());
  }

  isConnected() {
    return this.connected;
  }

  onDisconnect(callback: () => void) {
    this.callbacks.push(callback);
  }

  async read(): Promise<RawMeasurement> {
    const cap = this.capacityLitres ?? 5000;
    this.level = Math.max(0, Math.min(cap, this.level + (this.random() - 0.3) * cap * 0.02));
    this.seq += 1;
    return {
      volume_litres: Math.round(this.level * 10) / 10,
      temperature_celsius: Math.round((3.5 + this.random()) * 10) / 10,
      battery_percent: 87,
      measured_at: new Date().toISOString(),
      measurement_id: `sim-${Date.now()}-${this.seq}`,
      sequence: this.seq,
    };
  }

  async subscribe(callback: (m: RawMeasurement) => void) {
    const timer = setInterval(async () => {
      if (this.connected) callback(await this.read());
    }, this.intervalMs);
    return () => clearInterval(timer);
  }

  async getDeviceInfo(): Promise<SensorDeviceInfo> {
    return {
      id: 'simulator',
      name: 'MilkOS sensor simulator',
      transport: 'SIMULATED',
      services: [],
      measures: { volume: true, temperature: true, battery: true },
      protocol: 'simulated',
    };
  }
}
