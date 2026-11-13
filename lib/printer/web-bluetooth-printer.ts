// Sends ESC/POS bytes to the paired Bluetooth receipt printer.
//
// The printer is chosen once (see printer-session.ts) and reused for every print: no pairing dialog each time.
// Bytes go out in small, paced chunks: Bluetooth Low Energy carries about 20 bytes per write, and cheap printers
// have tiny buffers, so writing as fast as possible garbles or truncates receipts.
import { choosePrinter, dropCachedCharacteristic, ensureConnected, findPrinter, writableCharacteristic } from '@/lib/printer/printer-session';

export interface ChunkOptions {
  /** Bytes per write. 20 is safe on every BLE device. */
  chunkSize?: number;
  /** Pause between writes so the printer can empty its buffer. */
  delayMs?: number;
  /** Extra attempts for a write that fails only because the previous one is still in progress. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = { chunkSize: 20, delayMs: 20, retries: 3 };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isBusyError = (e: unknown) => /already in progress|busy/i.test(e instanceof Error ? e.message : String(e));

type Writable = Pick<BluetoothRemoteGATTCharacteristic, 'properties' | 'writeValueWithResponse' | 'writeValueWithoutResponse'>;

/** Write `bytes` to a characteristic in order, in paced chunks. Resolves when the last chunk is written. */
export async function writeInChunks(characteristic: Writable, bytes: Uint8Array, options: ChunkOptions = {}): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? DEFAULTS.chunkSize));
  const delayMs = Math.max(0, options.delayMs ?? DEFAULTS.delayMs);
  const retries = Math.max(0, options.retries ?? DEFAULTS.retries);
  const sleep = options.sleep ?? defaultSleep;
  // Acknowledged writes give the printer a chance to push back, so prefer them when it offers both.
  const acknowledged = !!characteristic.properties.write;

  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.slice(start, start + chunkSize);
    for (let attempt = 0; ; attempt++) {
      try {
        await (acknowledged ? characteristic.writeValueWithResponse(chunk) : characteristic.writeValueWithoutResponse(chunk));
        break;
      } catch (e) {
        // Only the "still busy" refusal is retried: nothing was written, so no chunk is ever printed twice.
        if (!isBusyError(e) || attempt >= retries) throw e;
        await sleep(50 * (attempt + 1));
      }
    }
    if (start + chunkSize < bytes.length && delayMs > 0) await sleep(delayMs);
  }
}

async function send(escposBytes: Uint8Array, options: ChunkOptions): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported on this browser.');
  }

  // The remembered printer if there is one; otherwise one pairing dialog, after which it is remembered.
  let device = await findPrinter();
  const remembered = device !== null;
  device ??= await choosePrinter();

  let connection: Awaited<ReturnType<typeof ensureConnected>>;
  try {
    connection = await ensureConnected(device);
  } catch {
    throw new Error(
      remembered
        ? `Couldn’t reach the printer${device.name ? ` “${device.name}”` : ''}. Switch it on, bring it close and try again, or pair it again in Hardware settings.`
        : 'Failed to connect to the printer.',
    );
  }

  try {
    const characteristic = await writableCharacteristic(device, connection.server);
    await writeInChunks(characteristic, escposBytes, options);
    return true;
  } catch (e) {
    dropCachedCharacteristic(); // the connection may be stale: look the characteristic up afresh next time
    throw e;
  } finally {
    // Leave a connection somebody else opened (the hardware page) as it was; close the one opened for this print.
    if (connection.openedHere && device.gatt?.connected) device.gatt.disconnect();
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Print the bytes on the paired printer. Prints are queued, so two quick taps never interleave their output. */
export function printToBluetoothPrinter(escposBytes: Uint8Array, options: ChunkOptions = {}): Promise<boolean> {
  const run = queue.then(
    () => send(escposBytes, options),
    () => send(escposBytes, options),
  );
  queue = run.catch(() => undefined);
  return run;
}
