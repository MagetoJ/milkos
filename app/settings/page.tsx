import { BluetoothSettings } from "@/components/settings/BluetoothSettings";

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">System Settings</h1>
      
      {/* Bluetooth & Hardware Section */}
      <BluetoothSettings />
    </main>
  );
}