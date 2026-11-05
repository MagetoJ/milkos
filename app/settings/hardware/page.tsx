// app/settings/hardware/page.tsx
import { BluetoothSettings } from "@/components/settings/BluetoothSettings";

export default function HardwareSettingsPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Global Hardware & Device Management</h1>
        <p className="text-sm text-gray-500">
          Configure local Bluetooth peripherals and view system diagnostics.
        </p>
      </div>

      {/* 1. Global Pairing Controls */}
      <BluetoothSettings />

      {/* 2. Superadmin Hardware Diagnostics & Logs */}
      <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Hardware Diagnostics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-500 block text-xs">Web Bluetooth API</span>
            <span className="font-semibold text-emerald-600">Supported (Chrome/Edge)</span>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-500 block text-xs">Active Transport Protocol</span>
            <span className="font-semibold text-gray-700">ESC/POS + BLE GATT</span>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-500 block text-xs">Default Baud/Paper</span>
            <span className="font-semibold text-gray-700">9600 bps / 58mm Thermal</span>
          </div>
        </div>
      </div>
    </div>
  );
}