// GATT protocol adapters: which Bluetooth services to open and how to decode their bytes.
//
// Only Bluetooth SIG *standard* characteristics are included, because their formats are public:
//   Battery Service 0x180F / Battery Level 0x2A19           uint8, percent
//   Environmental Sensing 0x181A / Temperature 0x2A6E        sint16, 0.01 °C
// There is NO standard characteristic for milk volume. Litres can only be decoded once the cooler
// sensor's manufacturer protocol is known; register it with `registerProtocol` (see the example below).
// Nothing here invents service UUIDs or byte layouts for hardware that hasn't been selected.
import type { RawMeasurement } from '@/lib/sensors/types';

export interface MeasurementSpec {
  service: string | number;
  characteristic: string | number;
  /** Prefer notifications when the characteristic supports them. */
  notify?: boolean;
  decode: (value: DataView, calibration: Record<string, unknown> | null) => Partial<RawMeasurement>;
}

export interface GattProtocol {
  key: string;
  label: string;
  /** True only for protocols that are verified against real hardware or a published standard. */
  verified: boolean;
  measures: { volume: boolean; temperature: boolean; battery: boolean };
  measurements: MeasurementSpec[];
}

export const BATTERY_SERVICE = 0x180f;
export const BATTERY_LEVEL = 0x2a19;
export const ENVIRONMENTAL_SENSING = 0x181a;
export const TEMPERATURE = 0x2a6e;

export const decodeBatteryLevel = (v: DataView) => ({ battery_percent: Math.min(100, v.getUint8(0)) });
/** 0x8000 means "value not known" in the SIG format. */
export const decodeTemperature = (v: DataView) => {
  const raw = v.getInt16(0, true);
  return { temperature_celsius: raw === -32768 ? null : raw / 100 };
};

const STANDARD: GattProtocol = {
  key: 'ble-standard',
  label: 'Standard Bluetooth (battery + temperature only)',
  verified: true,
  measures: { volume: false, temperature: true, battery: true },
  measurements: [
    { service: BATTERY_SERVICE, characteristic: BATTERY_LEVEL, notify: true, decode: decodeBatteryLevel },
    { service: ENVIRONMENTAL_SENSING, characteristic: TEMPERATURE, notify: true, decode: decodeTemperature },
  ],
};

const registry = new Map<string, GattProtocol>([[STANDARD.key, STANDARD]]);

/**
 * Add a manufacturer protocol once the hardware is chosen, e.g.
 *
 *   registerProtocol({
 *     key: 'acme-tankprobe-v1', label: 'ACME TankProbe', verified: true,
 *     measures: { volume: true, temperature: true, battery: true },
 *     measurements: [{ service: '<from the datasheet>', characteristic: '<from the datasheet>', notify: true,
 *                      decode: (v, cal) => ({ volume_litres: litresFromLevel(v.getUint16(0, true), cal) }) }],
 *   });
 */
export function registerProtocol(protocol: GattProtocol) {
  registry.set(protocol.key, protocol);
}

export function getProtocol(key: string | null | undefined): GattProtocol {
  return (key && registry.get(key)) || STANDARD;
}

export function listProtocols(): GattProtocol[] {
  return [...registry.values()];
}

/** Every service any known protocol may open (Web Bluetooth only exposes services requested up front). */
export function allOptionalServices(): (string | number)[] {
  const out = new Set<string | number>();
  for (const p of registry.values()) for (const m of p.measurements) out.add(m.service);
  return [...out];
}
