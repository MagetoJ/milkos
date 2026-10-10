'use client';

import Link from 'next/link';
import { AccountSettings } from '@/components/settings/account-settings';

/** The platform administrator's PERSONAL settings. Platform-wide configuration stays on /superadmin/settings. */
export default function SuperadminAccountPage() {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My account</h1>
          <p className="mt-1 text-mo-muted">Your profile, sign-in security and notifications. These affect only you.</p>
        </div>
        <Link href="/superadmin/settings" className="text-sm font-medium text-mo-brand underline-offset-2 hover:underline">Platform settings →</Link>
      </header>
      <AccountSettings />
    </>
  );
}
