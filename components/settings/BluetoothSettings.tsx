"use client";

import React, { useState, useEffect } from "react";

interface SavedDevice {
  id: string;
  name: string;
  type: "scale" | "printer";
  savedAt: string;
}

export function BluetoothSettings() {
  const [savedScale, setSavedScale] = useState<SavedDevice | null>(null);
  const [savedPrinter, setSavedPrinter] = useState<SavedDevice | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load saved configuration on mount
  useEffect(() => {
    const scale = localStorage.getItem("milkos_saved_scale");
    const printer = localStorage.getItem("milkos_saved_printer");

    if (scale) setSavedScale(JSON.parse(scale));
    if (printer) setSavedPrinter(JSON.parse(printer));
  }, []);

  // Connect & Save a Bluetooth Peripheral
  async function handleConnectDevice(type: "scale" | "printer") {
    if (!navigator.bluetooth) {
      setStatusMessage("Web Bluetooth is not supported on this browser or device.");
      return;
    }

    try {
      setIsScanning(true);
      setStatusMessage(`Scanning for nearby Bluetooth ${type}s...`);

      // Filter settings depending on peripheral type
      const options: RequestDeviceOptions =
        type === "scale"
          ? {
              filters: [{ services: ["0000180f-0000-1000-8000-00805f9b34fb"] }], // Battery/Generic BLE service
              optionalServices: ["0000180f-0000-1000-8000-00805f9b34fb"],
            }
          : {
              acceptAllDevices: true,
              optionalServices: [
                "000018f0-0000-1000-8000-00805f9b34fb",
                "49535343-fe7d-4ae5-8fa9-9fafd205e455",
              ],
            };

      const device = await navigator.bluetooth.requestDevice(options);

      const deviceConfig: SavedDevice = {
        id: device.id,
        name: device.name || `Generic ${type === "scale" ? "Scale" : "Printer"}`,
        type,
        savedAt: new Date().toLocaleTimeString(),
      };

      if (type === "scale") {
        localStorage.setItem("milkos_saved_scale", JSON.stringify(deviceConfig));
        setSavedScale(deviceConfig);
      } else {
        localStorage.setItem("milkos_saved_printer", JSON.stringify(deviceConfig));
        setSavedPrinter(deviceConfig);
      }

      setStatusMessage(`Successfully paired ${deviceConfig.name}!`);
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        setStatusMessage(`Connection failed: ${err.message}`);
      } else {
        setStatusMessage("Scanning cancelled.");
      }
    } finally {
      setIsScanning(false);
    }
  }

  // Remove saved device
  function handleForgetDevice(type: "scale" | "printer") {
    if (type === "scale") {
      localStorage.removeItem("milkos_saved_scale");
      setSavedScale(null);
    } else {
      localStorage.removeItem("milkos_saved_printer");
      setSavedPrinter(null);
    }
    setStatusMessage(`Removed saved ${type}.`);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="border-b pb-4 mb-6">
        <h2 className="text-xl font-bold text-gray-800">Hardware & Bluetooth Settings</h2>
        <p className="text-sm text-gray-500">
          Pair and manage digital weighing scales and portable thermal receipt printers.
        </p>
      </div>

      {statusMessage && (
        <div className="mb-4 p-3 text-sm bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
          {statusMessage}
        </div>
      )}

      <div className="space-y-6">
        {/* Digital Weighing Scale Card */}
        <div className="p-4 border rounded-lg flex items-center justify-between bg-gray-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-800">Digital Weighing Scale</span>
              {savedScale ? (
                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">
                  Paired
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-full font-medium">
                  Not Configured
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {savedScale ? `Device: ${savedScale.name}` : "Used for automated milk weight intake."}
            </p>
          </div>

          <div className="flex gap-2">
            {savedScale ? (
              <button
                onClick={() => handleForgetDevice("scale")}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-md transition-colors"
              >
                Forget
              </button>
            ) : (
              <button
                onClick={() => handleConnectDevice("scale")}
                disabled={isScanning}
                className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isScanning ? "Scanning..." : "Pair Scale"}
              </button>
            )}
          </div>
        </div>

        {/* Thermal Receipt Printer Card */}
        <div className="p-4 border rounded-lg flex items-center justify-between bg-gray-50">
          <div>
            <div className="flex flex-center gap-2">
              <span className="font-semibold text-gray-800">Thermal Receipt Printer</span>
              {savedPrinter ? (
                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">
                  Paired
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-full font-medium">
                  Not Configured
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {savedPrinter ? `Device: ${savedPrinter.name}` : "Used for ESC/POS receipt printing."}
            </p>
          </div>

          <div className="flex gap-2">
            {savedPrinter ? (
              <button
                onClick={() => handleForgetDevice("printer")}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-md transition-colors"
              >
                Forget
              </button>
            ) : (
              <button
                onClick={() => handleConnectDevice("printer")}
                disabled={isScanning}
                className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isScanning ? "Scanning..." : "Pair Printer"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}