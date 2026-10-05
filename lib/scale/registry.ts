// Which scale adapters this build offers. Hardware adapters are registered here once their protocol has
// been verified on the actual device (see lib/scale/types.ts); none is registered today.
import { isBluetoothSupported } from '@/lib/bluetooth/capability';
import { MockScaleAdapter, scaleSimulatorEnabled } from './mock-adapter';
import type { ScaleAdapter, ScaleTransport } from './types';

export interface ScaleAdapterDefinition {
  key: string;
  label: string;
  transport: ScaleTransport;
  /** Only verified adapters are offered to collectors. */
  verified: boolean;
  create(): ScaleAdapter;
}

const registered: ScaleAdapterDefinition[] = [];

/** Add a hardware adapter (call at startup). Unverified adapters are kept out of the collector's list. */
export function registerScaleAdapter(definition: ScaleAdapterDefinition) {
  if (!registered.some((d) => d.key === definition.key)) registered.push(definition);
}

export function availableScaleAdapters(): ScaleAdapterDefinition[] {
  const list = registered.filter((d) => d.verified);
  if (scaleSimulatorEnabled()) {
    list.push({
      key: 'simulator',
      label: 'Scale simulator (development only)',
      transport: 'SIMULATED',
      verified: true,
      create: () => new MockScaleAdapter({ initialLoadKg: 0 }),
    });
  }
  return list;
}

/** Why no real scale can be connected on this device right now (shown next to "Enter weight manually"). */
export function hardwareScaleNote(): string {
  if (registered.some((d) => d.verified && d.transport !== 'SIMULATED')) return '';
  const base = 'No Bluetooth scale model has been verified for MilkOS yet, so a real scale can’t be connected.';
  return isBluetoothSupported()
    ? `${base} Enter the weight shown on the scale manually.`
    : `${base} This browser has no Web Bluetooth either. Enter the weight manually.`;
}
