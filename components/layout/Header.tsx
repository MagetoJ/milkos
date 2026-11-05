"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { BluetoothConnected, BluetoothOff } from "lucide-react";
import { useBluetooth } from "@/lib/bluetooth/bluetooth-context";
import { BluetoothGlobalHeader } from "@/components/layout/BluetoothGlobalHeader";

export function BluetoothGlobalHeader() {
  const { connectedDevices } = useBluetooth();
  const [hasSavedHardware, setHasSavedHardware] = useState(false);

  // Sync saved hardware setup from localStorage on mount
  useEffect(() => {
    const scale = localStorage.getItem("milkOS_scale_device_id") || localStorage.getItem("milkos_saved_scale");
    const printer = localStorage.getItem("milkOS_printer_device_id") || localStorage.getItem("milkos_saved_printer");
    setHasSavedHardware(!!(scale || printer));
  }, []);

  const connectedScales = connectedDevices.filter((d) => d.type === "scale" && d.connected);
  const connectedPrinters = connectedDevices.filter((d) => d.type === "printer" && d.connected);

  const isScaleConnected = connectedScales.length > 0;
  const isPrinterConnected = connectedPrinters.length > 0;
  const isAnyActive = isScaleConnected || isPrinterConnected;

  // Determine badge label dynamically
  const getStatusLabel = () => {
    if (isScaleConnected && isPrinterConnected) return "Scale & Printer Active";
    if (isScaleConnected) return "Scale Active";
    if (isPrinterConnected) return "Printer Active";
    if (hasSavedHardware) return "Hardware Paired (Idle)";
    return "No BLE Hardware";
  };

  return (
    <div className="flex items-center gap-3">
      {/* Quick Hardware Status Indicator */}
      <Link
        href="/settings/hardware"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isAnyActive
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
        }`}
        title="Manage Bluetooth Hardware"
      >
        {isAnyActive ? (
          <BluetoothConnected className="w-4 h-4 text-emerald-600 animate-pulse" />
        ) : (
          <BluetoothOff className="w-4 h-4 text-gray-400" />
        )}
        <span className="hidden md:inline">{getStatusLabel()}</span>
      </Link>
    </div>
  );
}