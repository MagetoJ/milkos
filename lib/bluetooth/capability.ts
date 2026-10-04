// Can this browser talk to Bluetooth Low Energy devices at all?
//
// Web Bluetooth exists in Chromium browsers (Chrome/Edge on Android, Windows, macOS, ChromeOS, Linux with
// a flag) and needs a secure context (HTTPS or localhost). It is NOT available in Firefox or in any browser
// on iOS. Where it isn't, cooler sensors need the future native Android bridge (lib/bluetooth/native-bridge.ts).

export interface BluetoothCapability {
  supported: boolean;
  /** Adapter present and switched on (null when the browser can't tell). */
  available: boolean | null;
  reason: string | null;
}

interface NavigatorWithBluetooth {
  bluetooth?: { getAvailability?: () => Promise<boolean>; requestDevice?: unknown };
}

export function isBluetoothSupported(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined, secure = typeof window !== 'undefined' ? window.isSecureContext : false): boolean {
  const bt = (nav as NavigatorWithBluetooth | undefined)?.bluetooth;
  return !!secure && !!bt && typeof bt.requestDevice === 'function';
}

export async function getBluetoothCapability(
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
  secure = typeof window !== 'undefined' ? window.isSecureContext : false,
): Promise<BluetoothCapability> {
  const bt = (nav as NavigatorWithBluetooth | undefined)?.bluetooth;
  if (!secure) return { supported: false, available: null, reason: 'Bluetooth needs a secure (HTTPS) connection to MilkOS.' };
  if (!bt || typeof bt.requestDevice !== 'function') {
    return {
      supported: false,
      available: null,
      reason: 'This browser can’t connect to Bluetooth sensors. Use Chrome or Edge on Android, Windows or macOS. (iPhones and Firefox don’t support Web Bluetooth; the MilkOS Android app will.)',
    };
  }
  let available: boolean | null = null;
  try {
    available = typeof bt.getAvailability === 'function' ? await bt.getAvailability() : null;
  } catch {
    available = null;
  }
  return {
    supported: true,
    available,
    reason: available === false ? 'Bluetooth is switched off or this device has no Bluetooth adapter.' : null,
  };
}
