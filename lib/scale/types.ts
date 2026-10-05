// The scale abstraction. The collection screens depend ONLY on these types, never on navigator.bluetooth or
// a vendor SDK, so a real scale can be added later as one more adapter without touching the workflow.
//
// It mirrors the cooler SensorAdapter architecture (lib/sensors/types.ts) but is a separate interface:
// a sensor reports a cooler's level over time; a scale weighs one load that a collector then captures.
//
// No hardware adapter ships yet: weighing scales differ per manufacturer, and nothing here invents a
// Bluetooth service, characteristic or byte layout. Until a scale's protocol is verified on real hardware,
// collectors use the simulator (development) or type the weight in, which is always labelled MANUAL.

export type ScaleTransport = 'BLUETOOTH_LE' | 'NATIVE_BRIDGE' | 'SIMULATED';
export type ScaleConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** One weight the scale reported. `stable` is decided by the adapter (or by StabilityDetector). */
export interface WeightReading {
  kg: number;
  stable: boolean;
  /** Device time of the reading, ISO 8601. */
  at: string;
}

export interface ScaleCapabilities {
  tare: boolean;
  battery: boolean;
  /** The device itself reports stability; otherwise it's derived from consecutive readings. */
  stabilityFlag: boolean;
}

export interface ScaleStatus {
  state: ScaleConnectionState;
  transport: ScaleTransport;
  deviceId: string | null;
  deviceName: string | null;
  batteryPercent: number | null;
  lastSeenAt: string | null;
  error: string | null;
  capabilities: ScaleCapabilities;
}

export interface ScaleAdapter {
  readonly transport: ScaleTransport;
  /** True only for adapters verified against real hardware (or the simulator, which is never real). */
  readonly verified: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ScaleStatus;
  /** The current reading (may be unstable). */
  getWeight(): Promise<WeightReading>;
  /** Zero the scale with the current load (e.g. the empty can). */
  tare(): Promise<void>;
  /** The current weight, only if stable. Throws ScaleNotStableError otherwise. */
  capture(): Promise<WeightReading>;
  /** Live readings. Returns an unsubscribe function. */
  subscribeToWeightUpdates(callback: (reading: WeightReading) => void): () => void;
  /** Connection / battery / error changes. Returns an unsubscribe function. */
  onStatusChange(callback: (status: ScaleStatus) => void): () => void;
}

export class ScaleNotStableError extends Error {
  constructor() {
    super('The weight is still changing. Wait until it is stable, then capture.');
  }
}

export class ScaleUnavailableError extends Error {}

/** How a batch's weight was obtained (backend WeightSource). */
export type WeightSource = 'SCALE' | 'MANUAL' | 'SIMULATED';

export const SOURCE_OF_SCALE: Record<ScaleTransport, WeightSource> = {
  BLUETOOTH_LE: 'SCALE',
  NATIVE_BRIDGE: 'SCALE',
  SIMULATED: 'SIMULATED',
};
