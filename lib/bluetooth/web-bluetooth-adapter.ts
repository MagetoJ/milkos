// SensorAdapter over the browser's Web Bluetooth API. Decoding is delegated to a GattProtocol
// (lib/bluetooth/protocols.ts); this file only deals with discovery, connection and GATT I/O.
import {
  SensorUnavailableError,
  type GattServiceInfo,
  type RawMeasurement,
  type SensorAdapter,
  type SensorDeviceInfo,
} from '@/lib/sensors/types';
import { isBluetoothSupported } from './capability';
import { allOptionalServices, BATTERY_LEVEL, getProtocol, TEMPERATURE, type GattProtocol } from './protocols';

// Minimal Web Bluetooth typings (not part of TypeScript's DOM library).
interface BTCharacteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  properties: Record<string, boolean>;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BTCharacteristic>;
  stopNotifications(): Promise<BTCharacteristic>;
}
interface BTService {
  uuid: string;
  getCharacteristic(uuid: string | number): Promise<BTCharacteristic>;
  getCharacteristics(): Promise<BTCharacteristic[]>;
}
interface BTServer {
  connected: boolean;
  connect(): Promise<BTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string | number): Promise<BTService>;
  getPrimaryServices(): Promise<BTService[]>;
}
export interface BTDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BTServer;
}
interface BTNavigator {
  bluetooth: { requestDevice(options: Record<string, unknown>): Promise<BTDevice> };
}

const PROPERTIES = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'];

/** Ask the user to pick a nearby device (must be called from a click). */
export async function chooseBluetoothDevice(): Promise<BTDevice> {
  if (!isBluetoothSupported()) throw new SensorUnavailableError('Web Bluetooth is not available in this browser.');
  return (navigator as unknown as BTNavigator).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: allOptionalServices(),
  });
}

export class WebBluetoothSensorAdapter implements SensorAdapter {
  readonly transport = 'BLUETOOTH_LE' as const;
  private server: BTServer | null = null;
  private disconnectCallbacks: (() => void)[] = [];
  private protocol: GattProtocol;
  private services: GattServiceInfo[] = [];

  constructor(
    private device: BTDevice,
    protocolKey: string | null,
    private calibration: Record<string, unknown> | null = null,
  ) {
    this.protocol = getProtocol(protocolKey);
    device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.disconnectCallbacks.forEach((cb) => cb());
    });
  }

  async connect(): Promise<void> {
    if (!this.device.gatt) throw new SensorUnavailableError('This device has no GATT server.');
    this.server = await this.device.gatt.connect();
    this.services = await this.discover();
  }

  async disconnect(): Promise<void> {
    this.server?.disconnect();
    this.server = null;
  }

  isConnected(): boolean {
    return !!this.server?.connected;
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  private async discover(): Promise<GattServiceInfo[]> {
    if (!this.server) return [];
    let services: BTService[] = [];
    try {
      services = await this.server.getPrimaryServices();
    } catch {
      return []; // none of the requested services are present
    }
    const out: GattServiceInfo[] = [];
    for (const service of services) {
      let characteristics: BTCharacteristic[] = [];
      try {
        characteristics = await service.getCharacteristics();
      } catch {
        /* not readable */
      }
      out.push({
        uuid: service.uuid,
        characteristics: characteristics.map((c) => ({ uuid: c.uuid, properties: PROPERTIES.filter((p) => c.properties?.[p]) })),
      });
    }
    return out;
  }

  private async characteristic(spec: { service: string | number; characteristic: string | number }) {
    if (!this.server) throw new SensorUnavailableError('Not connected.');
    const service = await this.server.getPrimaryService(spec.service);
    return service.getCharacteristic(spec.characteristic);
  }

  async read(): Promise<RawMeasurement> {
    const out: RawMeasurement = {};
    for (const spec of this.protocol.measurements) {
      try {
        const value = await (await this.characteristic(spec)).readValue();
        Object.assign(out, spec.decode(value, this.calibration));
      } catch {
        /* this device doesn't offer this measurement */
      }
    }
    out.measured_at = new Date().toISOString();
    return out;
  }

  async subscribe(callback: (measurement: RawMeasurement) => void): Promise<() => void> {
    const stops: (() => void)[] = [];
    for (const spec of this.protocol.measurements.filter((m) => m.notify)) {
      try {
        const ch = await this.characteristic(spec);
        if (!ch.properties?.notify) continue;
        const handler = () => {
          if (ch.value) callback({ ...spec.decode(ch.value, this.calibration), measured_at: new Date().toISOString() });
        };
        ch.addEventListener('characteristicvaluechanged', handler);
        await ch.startNotifications();
        stops.push(() => {
          ch.removeEventListener('characteristicvaluechanged', handler);
          void ch.stopNotifications().catch(() => undefined);
        });
      } catch {
        /* not offered by this device */
      }
    }
    return () => stops.forEach((stop) => stop());
  }

  async getDeviceInfo(): Promise<SensorDeviceInfo> {
    const available = new Set(this.services.flatMap((s) => s.characteristics.map((c) => c.uuid)));
    const has = (n: number | string) => available.has(typeof n === 'number' ? uuid16(n) : n);
    const offered = new Set(this.protocol.measurements.filter((m) => has(m.characteristic)).map((m) => m.characteristic));
    const none = { volume: false, temperature: false, battery: false };
    const measures =
      this.protocol.key === 'ble-standard'
        ? { volume: false, temperature: offered.has(TEMPERATURE), battery: offered.has(BATTERY_LEVEL) }
        : offered.size > 0
          ? this.protocol.measures
          : none;
    return {
      id: this.device.id,
      name: this.device.name ?? null,
      transport: this.transport,
      services: this.services,
      measures,
      protocol: this.protocol.key,
    };
  }
}

/** 16-bit SIG UUID -> full 128-bit form, as Web Bluetooth reports it. */
export function uuid16(n: number): string {
  return `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}
