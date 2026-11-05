"use client";

import React, { useState } from "react";
import { useBluetooth } from "@/lib/bluetooth/bluetooth-context";

export default function HardwareSettingsPage() {
  const { isSupported, connectedDevices, isScanning, error, requestDevice, disconnectDevice } = useBluetooth();
  const [testWeight, setTestWeight] = useState<string | null>(null);

  const handlePairScale = async () => {
    const device = await requestDevice(undefined, "scale");
    if (device) {
      localStorage.setItem("milkOS_scale_device_id", device.id);
    }
  };

  const handlePairPrinter = async () => {
    const device = await requestDevice(undefined, "printer");
    if (device) {
      localStorage.setItem("milkOS_printer_device_id", device.id);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hardware & Bluetooth Settings</h1>
        <p className="text-sm text-gray-600">Connect smart weighing scales and Bluetooth receipt printers.</p>
      </div>

      {!isSupported && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          ⚠️ <strong>Web Bluetooth Unavailable:</strong> Ensure you are using Chrome/Edge on HTTPS or localhost.
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Weighing Scale Section */}
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Digital Weighing Scale</h2>
            <p className="text-xs text-gray-500">Auto-read weight values into collection forms</p>
          </div>
          <button
            onClick={handlePairScale}
            disabled={isScanning || !isSupported}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {isScanning ? "Scanning..." : "Pair Scale"}
          </button>
        </div>

        {connectedDevices.filter((d) => d.type === "scale").map((device) => (
          <div key={device.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium text-sm text-gray-900">{device.name}</p>
              <p className="text-xs text-gray-500">Status: {device.connected ? "Connected" : "Disconnected"}</p>
            </div>
            <button
              onClick={() => disconnectDevice(device.id)}
              className="px-3 py-1 bg-red-100 text-red-600 hover:bg-red-200 text-xs font-semibold rounded"
            >
              Disconnect
            </button>
          </div>
        ))}
      </div>

      {/* Bluetooth Printer Section */}
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Thermal Receipt Printer</h2>
            <p className="text-xs text-gray-500">Print collection slips automatically upon saving</p>
          </div>
          <button
            onClick={handlePairPrinter}
            disabled={isScanning || !isSupported}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {isScanning ? "Scanning..." : "Pair Printer"}
          </button>
        </div>

        {connectedDevices.filter((d) => d.type === "printer").map((device) => (
          <div key={device.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
            <div>
              <p className="font-medium text-sm text-gray-900">{device.name}</p>
              <p className="text-xs text-gray-500">Status: {device.connected ? "Connected" : "Disconnected"}</p>
            </div>
            <button
              onClick={() => disconnectDevice(device.id)}
              className="px-3 py-1 bg-red-100 text-red-600 hover:bg-red-200 text-xs font-semibold rounded"
            >
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}