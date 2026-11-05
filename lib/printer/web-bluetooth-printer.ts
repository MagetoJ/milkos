// lib/printer/web-bluetooth-printer.ts

// Common Bluetooth GATT Service UUIDs used by standard 58mm/80mm ESC/POS printers
const COMMON_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Serial Port Profile over BLE
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

export async function printToBluetoothPrinter(escposBytes: Uint8Array): Promise<boolean> {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported on this browser.');
  }

  // 1. Prompt browser dialog to pair printer
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: COMMON_PRINTER_SERVICES,
  });

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Failed to connect to printer GATT server.');

  // 2. Discover writable service & characteristic
  let writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  const services = await server.getPrimaryServices();

  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const char of characteristics) {
      if (char.properties.write || char.properties.writeWithoutResponse) {
        writeCharacteristic = char;
        break;
      }
    }
    if (writeCharacteristic) break;
  }

  if (!writeCharacteristic) {
    throw new Error('No writable Bluetooth printer characteristic found.');
  }

  // 3. Send ESC/POS data in chunked packets (20-byte payload limit for BLE compatibility)
  const CHUNK_SIZE = 20;
  for (let i = 0; i < escposBytes.length; i += CHUNK_SIZE) {
    const chunk = escposBytes.slice(i, i + CHUNK_SIZE);
    if (writeCharacteristic.properties.writeWithoutResponse) {
      await writeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await writeCharacteristic.writeValueWithResponse(chunk);
    }
  }

  // Disconnect after transmission completes
  device.gatt?.disconnect();
  return true;
}