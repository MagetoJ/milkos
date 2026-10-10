'use client';

// Farmer settings: very simple. Editable information is kept apart from what the cooperative controls
// (member number, cooperative, centre, name in the member register, payments).
import { AccountSettings } from '@/components/settings/account-settings';

export default function FarmerSettingsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Settings</h1>
      <p className="mb-4 text-sm text-mo-muted">Items with a lock are kept by your cooperative. Ask them to change those.</p>
      <AccountSettings compact sections={['profile', 'phone', 'notifications', 'password', 'mfa', 'sessions', 'activity']} />
    </div>
  );
}
