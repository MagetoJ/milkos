// The paired Bluetooth receipt printer, shared by every screen that pairs or prints.
//
// Before this module the hardware page, the settings card and the print function each paired on their own,
// asked for different Bluetooth services (a browser only lets a page use the services it listed when the
// device was chosen) and forgot the printer after every print. Now there is one printer: it is chosen once,
// remembered in this tab and, through the browser's permission list, across reloads, and reused for every print.

/** Services requested whenever a printer is chosen. Must be the same everywhere a printer is paired. */
export const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // serial-port style service used by many 58mm/80mm ESC/POS printers
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const ID_KEY = 'milkOS_printer_device_id'; // written by the hardware page (a plain device id)
const SETTINGS_KEY = 'milkos_saved_printer'; // written by the settings card (JSON with an `id`)
const RECONNECT_WAIT_MS = 8000;

let current: BluetoothDevice | null = null;
let cached: { device: BluetoothDevice; characteristic: BluetoothRemoteGATTCharacteristic } | null = null;
const watched = new WeakSet<BluetoothDevice>();

const bluetooth = (): Bluetooth | undefined => (typeof navigator !== 'undefined' ? navigator.bluetooth : undefined);

/** The id of the printer paired on this device, whichever screen paired it. */
export function savedPrinterId(): string | null {
  try {
    const plain = localStorage.getItem(ID_KEY);
    if (plain) return plain;
    const json = localStorage.getItem(SETTINGS_KEY);
    const id = json ? (JSON.parse(json) as { id?: unknown }).id : null;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function watchDisconnect(device: BluetoothDevice) {
  if (watched.has(device)) return;
  watched.add(device);
  // Characteristics from an old connection stop working once the printer disconnects, so never reuse them.
  device.addEventListener('gattserverdisconnected', () => {
    if (cached?.device === device) cached = null;
  });
}

/** Use this device as the printer from now on (call right after the browser's pairing dialog). */
export function rememberPrinter(device: BluetoothDevice) {
  current = device;
  cached = null;
  watchDisconnect(device);
  try {
    localStorage.setItem(ID_KEY, device.id);
  } catch {
    /* storage unavailable: the printer is still remembered for this tab */
  }
}

/** Stop using the paired printer: disconnect it and clear every saved trace. */
export function forgetPrinter() {
  try {
    if (current?.gatt?.connected) current.gatt.disconnect();
  } catch {
    /* already gone */
  }
  current = null;
  cached = null;
  try {
    localStorage.removeItem(ID_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* ignore */
  }
}

/** The remembered printer, or null when none was paired or the browser no longer allows access to it. */
export async function findPrinter(): Promise<BluetoothDevice | null> {
  if (current) return current;
  const id = savedPrinterId();
  if (!id) return null;
  try {
    const known = await bluetooth()?.getDevices?.();
    const match = known?.find((d) => d.id === id);
    if (match) {
      current = match;
      watchDisconnect(match);
      return match;
    }
  } catch {
    /* getDevices is not available everywhere: the caller falls back to the pairing dialog */
  }
  return null;
}

/** Show the browser's pairing dialog and remember the chosen printer. */
export async function choosePrinter(): Promise<BluetoothDevice> {
  const bt = bluetooth();
  if (!bt) throw new Error('Web Bluetooth is not supported on this browser.');
  const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  rememberPrinter(device);
  return device;
}

function waitForAdvertisement(device: BluetoothDevice, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = new AbortController();
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      device.removeEventListener('advertisementreceived', onAdvertisement);
      abort.abort();
      if (error) reject(error);
      else resolve();
    };
    const onAdvertisement = () => finish();
    const timer = setTimeout(() => finish(new Error('The printer was not seen nearby.')), timeoutMs);
    device.addEventListener('advertisementreceived', onAdvertisement);
    device.watchAdvertisements({ signal: abort.signal }).catch((e) => finish(e));
  });
}

async function connectGatt(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer> {
  const gatt = device.gatt;
  if (!gatt) throw new Error('This device does not offer a Bluetooth connection.');
  try {
    return await gatt.connect();
  } catch (first) {
    // A printer remembered from an earlier visit may need to be seen advertising before it accepts a connection.
    if (typeof device.watchAdvertisements !== 'function') throw first;
    try {
      await waitForAdvertisement(device, RECONNECT_WAIT_MS);
      return await gatt.connect();
    } catch {
      throw first;
    }
  }
}

/** Make sure the printer is connected. `openedHere` is true when this call had to open the connection. */
export async function ensureConnected(device: BluetoothDevice): Promise<{ server: BluetoothRemoteGATTServer; openedHere: boolean }> {
  if (device.gatt?.connected) return { server: device.gatt, openedHere: false };
  cached = null;
  return { server: await connectGatt(device), openedHere: true };
}

/** The characteristic ESC/POS bytes are written to (found once per connection, then reused). */
export async function writableCharacteristic(device: BluetoothDevice, server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
  if (cached?.device === device) return cached.characteristic;
  for (const service of await server.getPrimaryServices()) {
    for (const characteristic of await service.getCharacteristics()) {
      if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
        cached = { device, characteristic };
        return characteristic;
      }
    }
  }
  throw new Error('No writable Bluetooth printer characteristic found. Pair the printer again in Hardware settings.');
}

export function dropCachedCharacteristic() {
  cached = null;
}

/** Tests only: forget the in-memory printer (saved ids in localStorage are left alone). */
export function resetPrinterForTests() {
  current = null;
  cached = null;
}
