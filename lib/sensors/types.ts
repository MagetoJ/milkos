// The sensor abstraction. Cooler monitoring depends ONLY on these types, never on navigator.bluetooth,
// so the transport can change (Web Bluetooth today, an Android native bridge later) without touching it.
//
// Physical chain: level/weight sensor -> microcontroller -> Bluetooth -> this device -> local DB -> sync.
// Bluetooth carries bytes; turning them into litres is the job of a manufacturer-specific protocol adapter
// (lib/bluetooth/protocols.ts). No such adapter ships until the actual hardware is chosen.

export type SensorTransport = 'BLUETOOTH_LE' | 'NATIVE_BRIDGE' | 'SIMULATED';
/** Where a stored reading came from (backend ReadingSource). */
export type ReadingSource = 'BLUETOOTH' | 'NATIVE_BRIDGE' | 'MANUAL' | 'SIMULATED';

export const SOURCE_OF_TRANSPORT: Record<SensorTransport, ReadingSource> = {
  BLUETOOTH_LE: 'BLUETOOTH',
  NATIVE_BRIDGE: 'NATIVE_BRIDGE',
  SIMULATED: 'SIMULATED',
};

/** What an adapter decoded from the device, before it is tied to a cooler. Any field may be missing. */
export interface RawMeasurement {
  volume_litres?: number | null;
  temperature_celsius?: number | null;
  battery_percent?: number | null;
  signal_strength?: number | null;
  /** Device time of the measurement; the adapter's receive time if the device sends none. */
  measured_at?: string;
  /** The sensor's own event id / counter, used to collapse resent measurements. */
  measurement_id?: string | null;
  sequence?: number | null;
}

/** A normalised reading, ready to store (mirrors backend schemas/sync.py CoolerReadingIn). */
export interface SensorReading {
  cooler_id: string;
  sensor_id: string | null;
  volume_litres: number | null;
  temperature_celsius: number | null;
  battery_percent: number | null;
  signal_strength: number | null;
  measured_at: string;
  source: ReadingSource;
  measurement_id: string | null;
  sequence: number | null;
}

export interface GattCharacteristicInfo {
  uuid: string;
  properties: string[];
}

export interface GattServiceInfo {
  uuid: string;
  characteristics: GattCharacteristicInfo[];
}

export interface SensorDeviceInfo {
  /** Stable id of the hardware as seen by this transport (Web Bluetooth device id, serial number...). */
  id: string;
  name: string | null;
  transport: SensorTransport;
  /** Services/characteristics the device exposed (for choosing or developing a protocol adapter). */
  services: GattServiceInfo[];
  /** Which quantities the configured protocol can actually decode from this device. */
  measures: { volume: boolean; temperature: boolean; battery: boolean };
  protocol: string | null;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SensorAdapter {
  readonly transport: SensorTransport;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Read the current values once. */
  read(): Promise<RawMeasurement>;
  /** Receive values as the device pushes them. Returns an unsubscribe function. */
  subscribe?(callback: (measurement: RawMeasurement) => void): Promise<() => void>;
  /** Called when the link drops unexpectedly. */
  onDisconnect(callback: () => void): void;
  getDeviceInfo(): Promise<SensorDeviceInfo>;
}

/** A sensor registered on the server and bound to a cooler (backend sensor_devices). */
export interface CoolerSensorBinding {
  sensor_id: string | null; // null for a not-yet-registered device (readings are then flagged by the server)
  cooler_id: string;
  cooler_capacity_litres: number | null;
  protocol: string | null;
  calibration: Record<string, unknown> | null;
}

export class SensorUnavailableError extends Error {}
