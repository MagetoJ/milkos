import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { PRINTER_SERVICES } from '@/lib/printer/printer-session';

const ID_KEY = 'milkOS_printer_device_id';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ready = false;

export const isNative = () => Capacitor.isNativePlatform();

async function init() {
  if (ready) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  ready = true;
}

/** Shows Android's device picker once; the printer is then remembered. */
export async function pairNativePrinter(): Promise<{ deviceId: string; name?: string }> {
  await init();
  const device = await BleClient.requestDevice({ optionalServices: PRINTER_SERVICES });
  localStorage.setItem(ID_KEY, device.deviceId);
  return device;
}

export async function printNative(bytes: Uint8Array, options: { chunkSize?: number; delayMs?: number } = {}): Promise<boolean> {
  await init();
  const chunkSize = options.chunkSize ?? 20;
  const delayMs = options.delayMs ?? 20;
  const id = localStorage.getItem(ID_KEY) ?? (await pairNativePrinter()).deviceId;

  await BleClient.connect(id);
  try {
    const services = await BleClient.getServices(id);
    let target: { service: string; characteristic: string; withResponse: boolean } | null = null;
    for (const s of services) {
      for (const c of s.characteristics) {
        if (!target && (c.properties.write || c.properties.writeWithoutResponse)) {
          target = { service: s.uuid, characteristic: c.uuid, withResponse: !!c.properties.write };
        }
      }
    }
    if (!target) throw new Error('No writable characteristic found on this printer.');

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = new DataView(bytes.slice(i, i + chunkSize).buffer);
      if (target.withResponse) await BleClient.write(id, target.service, target.characteristic, chunk);
      else await BleClient.writeWithoutResponse(id, target.service, target.characteristic, chunk);
      if (i + chunkSize < bytes.length) await sleep(delayMs);
    }
    return true;
  } finally {
    await BleClient.disconnect(id).catch(() => undefined);
  }
}
