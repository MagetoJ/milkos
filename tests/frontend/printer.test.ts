// The Bluetooth receipt printer: one pairing reused for every print, and paced chunked writes.
// Real printers aren't available here, so these use fake devices that behave like Web Bluetooth ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINTER_SERVICES, forgetPrinter, rememberPrinter, resetPrinterForTests, savedPrinterId } from '@/lib/printer/printer-session';
import { printToBluetoothPrinter, writeInChunks } from '@/lib/printer/web-bluetooth-printer';

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256);
const noWait = { sleep: async () => undefined };

function fakeCharacteristic(opts: { write?: boolean; failWith?: string[] } = {}) {
  const written: number[][] = [];
  const failures = [...(opts.failWith ?? [])];
  const write = async (chunk: BufferSource) => {
    const message = failures.shift();
    if (message) throw new Error(message);
    written.push([...new Uint8Array(chunk as ArrayBuffer)]);
  };
  return {
    written,
    properties: { write: opts.write ?? true, writeWithoutResponse: !(opts.write ?? true) } as BluetoothCharacteristicProperties,
    writeValueWithResponse: vi.fn(write),
    writeValueWithoutResponse: vi.fn(write),
  };
}

function fakeDevice(id: string, opts: { connected?: boolean; unreachable?: boolean; name?: string } = {}) {
  const characteristic = fakeCharacteristic();
  const device = new EventTarget() as unknown as BluetoothDevice & { characteristic: typeof characteristic; lookups: number };
  const gatt = {
    connected: opts.connected ?? false,
    connect: vi.fn(async () => {
      if (opts.unreachable) throw new Error('Connection attempt failed');
      gatt.connected = true;
      return gatt;
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
      device.dispatchEvent(new Event('gattserverdisconnected'));
    }),
    getPrimaryServices: vi.fn(async () => {
      device.lookups++;
      return [{ getCharacteristics: async () => [characteristic] }];
    }),
  };
  Object.assign(device, { id, name: opts.name ?? 'Test Printer', gatt, characteristic, lookups: 0 });
  gatt.getPrimaryServices.mockName('getPrimaryServices');
  return device;
}

function stubBluetooth(chosen: BluetoothDevice | null, known: BluetoothDevice[] | undefined = []) {
  const bt = {
    requestDevice: vi.fn(async () => {
      if (!chosen) throw new Error('cancelled');
      return chosen;
    }),
    getDevices: known === undefined ? undefined : vi.fn(async () => known),
  };
  vi.stubGlobal('navigator', { bluetooth: bt });
  return bt;
}

beforeEach(() => {
  localStorage.clear();
  resetPrinterForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('writeInChunks', () => {
  it('sends every byte in order, in chunks of at most 20, pausing between chunks but not after the last', async () => {
    const ch = fakeCharacteristic();
    const sleeps: number[] = [];
    await writeInChunks(ch, bytesOf(45), { sleep: async (ms) => void sleeps.push(ms) });
    expect(ch.written.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(ch.written.flat()).toEqual([...bytesOf(45)]);
    expect(sleeps).toEqual([20, 20]);
  });

  it('uses acknowledged writes when offered and unacknowledged ones otherwise', async () => {
    const acked = fakeCharacteristic({ write: true });
    await writeInChunks(acked, bytesOf(5), noWait);
    expect(acked.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect(acked.writeValueWithoutResponse).not.toHaveBeenCalled();

    const fast = fakeCharacteristic({ write: false });
    await writeInChunks(fast, bytesOf(5), noWait);
    expect(fast.writeValueWithoutResponse).toHaveBeenCalledTimes(1);
  });

  it('retries a write refused because the previous one is in progress, without repeating any bytes', async () => {
    const ch = fakeCharacteristic({ failWith: ['GATT operation already in progress.'] });
    await writeInChunks(ch, bytesOf(30), noWait);
    expect(ch.written.flat()).toEqual([...bytesOf(30)]);
  });

  it('does not retry any other failure', async () => {
    const ch = fakeCharacteristic({ failWith: ['GATT Server is disconnected.'] });
    await expect(writeInChunks(ch, bytesOf(30), noWait)).rejects.toThrow('disconnected');
    expect(ch.writeValueWithResponse).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries are used', async () => {
    const busy = 'GATT operation already in progress.';
    const ch = fakeCharacteristic({ failWith: [busy, busy, busy, busy] });
    await expect(writeInChunks(ch, bytesOf(5), { ...noWait, retries: 3 })).rejects.toThrow('in progress');
  });
});

describe('printing on the paired printer', () => {
  it('asks to pair once, then reuses the printer for every later print', async () => {
    const printer = fakeDevice('p1');
    const bt = stubBluetooth(printer);
    await printToBluetoothPrinter(bytesOf(10), noWait);
    await printToBluetoothPrinter(bytesOf(10), noWait);
    expect(bt.requestDevice).toHaveBeenCalledTimes(1);
    expect(bt.requestDevice).toHaveBeenCalledWith({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    expect(printer.characteristic.written.flat()).toEqual([...bytesOf(10), ...bytesOf(10)]);
    expect(savedPrinterId()).toBe('p1');
  });

  it('uses a printer paired on the hardware page without asking again, and leaves it connected', async () => {
    const printer = fakeDevice('p2', { connected: true });
    const bt = stubBluetooth(null);
    rememberPrinter(printer);
    await printToBluetoothPrinter(bytesOf(10), noWait);
    expect(bt.requestDevice).not.toHaveBeenCalled();
    expect(printer.gatt!.connect).not.toHaveBeenCalled();
    expect(printer.gatt!.disconnect).not.toHaveBeenCalled();
    expect(printer.characteristic.written.flat()).toEqual([...bytesOf(10)]);
  });

  it('closes a connection it opened itself, and looks the characteristic up again on the next connection', async () => {
    const printer = fakeDevice('p3');
    stubBluetooth(printer);
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(printer.gatt!.connected).toBe(false);
    expect(printer.lookups).toBe(1);
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(printer.lookups).toBe(2); // a characteristic from the old connection must not be reused
  });

  it('finds the remembered printer after a page reload through the browser’s permission list', async () => {
    const printer = fakeDevice('p4');
    const bt = stubBluetooth(null, [fakeDevice('other'), printer]);
    localStorage.setItem('milkOS_printer_device_id', 'p4'); // survives the reload; the in-memory printer does not
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(bt.requestDevice).not.toHaveBeenCalled();
    expect(printer.characteristic.written.flat()).toEqual([...bytesOf(5)]);
  });

  it('understands the id saved by the settings card as well', async () => {
    localStorage.setItem('milkos_saved_printer', JSON.stringify({ id: 'p5', name: 'X', type: 'printer' }));
    expect(savedPrinterId()).toBe('p5');
    const printer = fakeDevice('p5');
    stubBluetooth(null, [printer]);
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(printer.characteristic.written.length).toBe(1);
  });

  it('falls back to the pairing dialog when the browser can’t list known devices', async () => {
    const printer = fakeDevice('p6');
    const bt = stubBluetooth(printer, undefined);
    localStorage.setItem('milkOS_printer_device_id', 'p6');
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(bt.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('explains an unreachable remembered printer instead of silently opening a dialog', async () => {
    const printer = fakeDevice('p7', { unreachable: true, name: 'Counter Printer' });
    const bt = stubBluetooth(null);
    rememberPrinter(printer);
    await expect(printToBluetoothPrinter(bytesOf(5), noWait)).rejects.toThrow(/Counter Printer.*Switch it on/);
    expect(bt.requestDevice).not.toHaveBeenCalled();
  });

  it('forgetting the printer clears every saved id so the next print asks to pair again', async () => {
    const printer = fakeDevice('p8');
    const bt = stubBluetooth(printer);
    await printToBluetoothPrinter(bytesOf(5), noWait);
    localStorage.setItem('milkos_saved_printer', JSON.stringify({ id: 'p8' }));
    forgetPrinter();
    expect(savedPrinterId()).toBeNull();
    await printToBluetoothPrinter(bytesOf(5), noWait);
    expect(bt.requestDevice).toHaveBeenCalledTimes(2);
  });

  it('queues prints so two quick taps never interleave', async () => {
    const printer = fakeDevice('p9');
    stubBluetooth(printer);
    const a = new Uint8Array(40).fill(1);
    const b = new Uint8Array(40).fill(2);
    await Promise.all([printToBluetoothPrinter(a, noWait), printToBluetoothPrinter(b, noWait)]);
    expect(printer.characteristic.written.flat()).toEqual([...a, ...b]);
  });

  it('reports a browser without Web Bluetooth', async () => {
    vi.stubGlobal('navigator', {});
    await expect(printToBluetoothPrinter(bytesOf(5), noWait)).rejects.toThrow(/not supported/);
  });
});
