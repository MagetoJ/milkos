"use client";
import React, { createContext, useContext, useState } from 'react';

interface BluetoothDeviceItem {
  id: string;
  name: string;
  type?: string;
  connected?: boolean;
}

interface BluetoothContextType {
  isSupported: boolean;
  connectedDevices: BluetoothDeviceItem[];
  isScanning: boolean;
  error: string | null;
  connectDevice: (type: string) => Promise<void>;
  requestDevice: (type?: string, category?: string) => Promise<BluetoothDeviceItem | null>;
  disconnectDevice: (id: string) => void;
}

const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined);

export function BluetoothProvider({ children }: { children: React.ReactNode }) {
  const [connectedDevices, setConnectedDevices] = useState<BluetoothDeviceItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectDevice = async (_type: string) => {};
  
  const requestDevice = async (type?: string, category?: string): Promise<BluetoothDeviceItem | null> => {
    setIsScanning(true);
    try {
      const targetType = category || type || 'generic';
      const mockDevice: BluetoothDeviceItem = {
        id: `dev-${Date.now()}`,
        name: `${targetType.toUpperCase()} Device`,
        type: targetType,
        connected: true
      };
      setConnectedDevices(prev => [...prev, mockDevice]);
      return mockDevice;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bluetooth error';
      setError(msg);
      return null;
    } finally {
      setIsScanning(false);
    }
  };

  const disconnectDevice = (id: string) => {
    setConnectedDevices(prev => prev.filter(d => d.id !== id));
  };

  return (
    <BluetoothContext.Provider value={{
      isSupported: true,
      connectedDevices,
      isScanning,
      error,
      connectDevice,
      requestDevice,
      disconnectDevice
    }}>
      {children}
    </BluetoothContext.Provider>
  );
}

export function useBluetooth() {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetooth must be used within a BluetoothProvider");
  }
  return context;
}
