// DEVELOPMENT SCALE SIMULATOR. Produces made-up weights so the collection workflow can be exercised without
// hardware. Batches captured with it are stored with weight_source SIMULATED, labelled "Simulated scale" in
// the UI and audit trail, and can be refused by the server (SCALE_ACCEPT_SIMULATED=false). It is offered only
// in development builds or when NEXT_PUBLIC_SCALE_SIMULATOR=1. It never claims to be a real scale.
import { roundKg, StabilityDetector } from './stability';
import { ScaleNotStableError, type ScaleAdapter, type ScaleStatus, type WeightReading } from './types';

export function scaleSimulatorEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SCALE_SIMULATOR === '1';
}

export interface MockScaleOptions {
  intervalMs?: number;
  /** Load placed on the scale when it connects (KG, gross). */
  initialLoadKg?: number;
  random?: () => number;
  now?: () => number;
  batteryPercent?: number | null;
}

export class MockScaleAdapter implements ScaleAdapter {
  readonly transport = 'SIMULATED' as const;
  readonly verified = true; // it is exactly what it says: a simulator
  private gross = 0;
  private target: number;
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private detector = new StabilityDetector();
  private weightListeners = new Set<(r: WeightReading) => void>();
  private statusListeners = new Set<(s: ScaleStatus) => void>();
  private status: ScaleStatus;
  private last: WeightReading | null = null;
  private random: () => number;
  private now: () => number;
  private intervalMs: number;

  constructor(options: MockScaleOptions = {}) {
    this.intervalMs = options.intervalMs ?? 300;
    this.target = options.initialLoadKg ?? 0;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.status = {
      state: 'disconnected',
      transport: 'SIMULATED',
      deviceId: 'scale-simulator',
      deviceName: 'Scale simulator (development)',
      batteryPercent: options.batteryPercent === undefined ? 92 : options.batteryPercent,
      lastSeenAt: null,
      error: null,
      capabilities: { tare: true, battery: options.batteryPercent !== null, stabilityFlag: false },
    };
  }

  private setStatus(patch: Partial<ScaleStatus>) {
    this.status = { ...this.status, ...patch };
    this.statusListeners.forEach((l) => l(this.status));
  }

  async connect() {
    this.setStatus({ state: 'connecting', error: null });
    this.setStatus({ state: 'connected', lastSeenAt: new Date(this.now()).toISOString() });
    if (!this.timer && this.intervalMs > 0) this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus({ state: 'disconnected' });
  }

  getStatus(): ScaleStatus {
    return this.status;
  }

  /** Simulator control: put a load (gross KG) on the scale; it settles over a few readings. */
  placeLoad(kg: number) {
    this.target = Math.max(0, kg);
    this.detector.reset();
  }

  /** One simulated reading (also driven by the interval timer). */
  async tick(): Promise<WeightReading> {
    const gap = this.target - this.gross;
    // Approach the load, then wobble a little (and stop wobbling once settled).
    this.gross = Math.abs(gap) < 0.02 ? this.target : this.gross + gap * 0.6 + (this.random() - 0.5) * Math.min(Math.abs(gap), 0.4);
    const kg = roundKg(Math.max(0, this.gross - this.offset));
    const at = this.now();
    const stable = this.detector.push(kg, at);
    this.last = { kg, stable, at: new Date(at).toISOString() };
    this.status = { ...this.status, lastSeenAt: this.last.at };
    this.weightListeners.forEach((l) => l(this.last!));
    return this.last;
  }

  async getWeight(): Promise<WeightReading> {
    this.assertConnected();
    return this.last ?? this.tick();
  }

  async tare() {
    this.assertConnected();
    this.offset = this.gross;
    this.detector.reset();
    await this.tick();
  }

  async capture(): Promise<WeightReading> {
    this.assertConnected();
    const reading = this.last ?? (await this.tick());
    if (!reading.stable || reading.kg <= 0) throw new ScaleNotStableError();
    return reading;
  }

  subscribeToWeightUpdates(callback: (reading: WeightReading) => void) {
    this.weightListeners.add(callback);
    return () => this.weightListeners.delete(callback);
  }

  onStatusChange(callback: (status: ScaleStatus) => void) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private assertConnected() {
    if (this.status.state !== 'connected') throw new Error('The scale is not connected.');
  }
}
