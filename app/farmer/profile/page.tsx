'use client';

import { AccountSettings } from '@/components/settings/account-settings';

/** The farmer's profile: what they can edit, and what their cooperative keeps (shown with a lock). */
export default function FarmerProfilePage() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">My profile</h1>
      <AccountSettings compact sections={['profile']} />
    </div>
  );
}
