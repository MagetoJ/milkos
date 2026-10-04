// Adapter boundary for a future MilkOS Android app that talks to sensors natively (where browsers can't,
// e.g. Bluetooth Classic, background scanning, iOS). The native app is expected to inject
// `window.MilkOSNative.sensors` implementing NativeSensorBridge. Until it exists, isNativeBridgeAvailable()
// is false and nothing pretends otherwise.
import { SensorUnavailableError, type RawMeasurement, type SensorAdapter, type SensorDeviceInfo } from '@/lib/sensors/types';

export interface NativeSensorBridge {
  connect(sensorId: string): Promise<void>;
  disconnect(sensorId: string): Promise<void>;
  isConnected(sensorId: string): boolean;
  read(sensorId: string): Promise<RawMeasurement>;
  subscribe(sensorId: string, callback: (m: RawMeasurement) => void): () => void;
  onDisconnect(sensorId: string, callback: () => void): void;
  info(sensorId: string): Promise<SensorDeviceInfo>;
}

function bridge(): NativeSensorBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { MilkOSNative?: { sensors?: NativeSensorBridge } }).MilkOSNative?.sensors ?? null;
}

export function isNativeBridgeAvailable(): boolean {
  return bridge() !== null;
}

export class NativeBridgeSensorAdapter implements SensorAdapter {
  readonly transport = 'NATIVE_BRIDGE' as const;

  constructor(private sensorId: string) {}

  private native(): NativeSensorBridge {
    const b = bridge();
    if (!b) throw new SensorUnavailableError('The MilkOS native app is not available on this device.');
    return b;
  }

  connect = () => this.native().connect(this.sensorId);
  disconnect = () => this.native().disconnect(this.sensorId);
  isConnected = () => bridge()?.isConnected(this.sensorId) ?? false;
  read = () => this.native().read(this.sensorId);
  getDeviceInfo = () => this.native().info(this.sensorId);
  onDisconnect = (callback: () => void) => this.native().onDisconnect(this.sensorId, callback);
  subscribe = async (callback: (m: RawMeasurement) => void) => this.native().subscribe(this.sensorId, callback);
}
