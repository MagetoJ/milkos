"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { PRINTER_SERVICES, rememberPrinter } from "@/lib/printer/printer-session";

export type BluetoothDeviceType = "scale" | "printer" | "unknown";

export interface BluetoothDeviceWrapper {
  id: string;
  name: string;
  gattDevice: BluetoothDevice;
  connected: boolean;
  type?: BluetoothDeviceType;
}

interface BluetoothContextType {
  isSupported: boolean;
  connectedDevices: BluetoothDeviceWrapper[];
  isScanning: boolean;
  error: string | null;
  requestDevice: (
    serviceUUID?: string,
    type?: BluetoothDeviceType
  ) => Promise<BluetoothDeviceWrapper | null>;
  disconnectDevice: (deviceId: string) => void;
}

const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined);

export const BluetoothProvider = ({ children }: { children: ReactNode }) => {
  const [connectedDevices, setConnectedDevices] = useState<BluetoothDeviceWrapper[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported = typeof window !== "undefined" && "bluetooth" in navigator;

  const requestDevice = useCallback(
    async (serviceUUID?: string, type: BluetoothDeviceType = "unknown") => {
      setError(null);
      
      if (!isSupported || !navigator.bluetooth) {
        setError("Web Bluetooth API is not supported in this browser or environment (requires HTTPS or localhost).");
        return null;
      }

      setIsScanning(true);
      try {
        // A printer is always requested with the shared printer services: the browser only lets the app use the
        // services listed here, and printing needs the same ones no matter which screen paired the printer.
        const options: RequestDeviceOptions = type === "printer"
          ? { acceptAllDevices: true, optionalServices: PRINTER_SERVICES }
          : serviceUUID
          ? { filters: [{ services: [serviceUUID] }] }
          : {
              acceptAllDevices: true,
              optionalServices: [
                "0000180f-0000-1000-8000-00805f9b34fb",
                "49535343-fe7d-4ae5-8fa9-9fafd205e455",
              ],
            };

        const device = await navigator.bluetooth.requestDevice(options);
        
        if (type === "printer") rememberPrinter(device); // printing reuses this printer instead of asking again
        const gattServer = await device.gatt?.connect();

        const wrappedDevice: BluetoothDeviceWrapper = {
          id: device.id,
          name: device.name || "Unknown Device",
          gattDevice: device,
          connected: gattServer?.connected ?? false,
          type,
        };

        // Listen for disconnects
        device.addEventListener("gattserverdisconnected", () => {
          setConnectedDevices((prev) =>
            prev.map((d) => (d.id === device.id ? { ...d, connected: false } : d))
          );
        });

        setConnectedDevices((prev) => {
          const filtered = prev.filter((d) => d.id !== device.id);
          return [...filtered, wrappedDevice];
        });

        return wrappedDevice;
      } catch (err: any) {
        if (err.name !== "NotFoundError") {
          // Ignore user cancellation
          setError(err.message || "Failed to connect to Bluetooth device.");
        }
        return null;
      } finally {
        setIsScanning(false);
      }
    },
    [isSupported]
  );

  const disconnectDevice = useCallback((deviceId: string) => {
    setConnectedDevices((prev) => {
      const target = prev.find((d) => d.id === deviceId);
      if (target?.gattDevice.gatt?.connected) {
        target.gattDevice.gatt.disconnect();
      }
      return prev.filter((d) => d.id !== deviceId);
    });
  }, []);

  return (
    <BluetoothContext.Provider
      value={{
        isSupported,
        connectedDevices,
        isScanning,
        error,
        requestDevice,
        disconnectDevice,
      }}
    >
      {children}
    </BluetoothContext.Provider>
  );
};

export const useBluetooth = () => {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetooth must be used within a BluetoothProvider");
  }
  return context;
};