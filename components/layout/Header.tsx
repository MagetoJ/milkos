// components/layout/BluetoothGlobalHeader.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Bluetooth, BluetoothConnected, BluetoothOff } from "lucide-react";

export function BluetoothGlobalHeader() {
  const [hasScale, setHasScale] = useState(false);
  const [hasPrinter, setHasPrinter] = useState(false);

  useEffect(() => {
    // Check saved status across sessions
    setHasScale(!!localStorage.getItem("milkos_saved_scale"));
    setHasPrinter(!!localStorage.getItem("milkos_saved_printer"));
  }, []);

  return (
    <div className="flex items-center gap-3">
      {/* Quick Hardware Status Indicator */}
      <a
        href="/settings/hardware"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 transition-colors"
        title="Manage Bluetooth Hardware"
      >
        {hasScale || hasPrinter ? (
          <BluetoothConnected className="w-4 h-4 text-emerald-600" />
        ) : (
          <BluetoothOff className="w-4 h-4 text-gray-400" />
        )}
        <span className="hidden md:inline">
          {hasScale && hasPrinter
            ? "Scale & Printer Paired"
            : hasScale
            ? "Scale Connected"
            : hasPrinter
            ? "Printer Connected"
            : "No BLE Hardware"}
        </span>
      </a>
    </div>
  );
}