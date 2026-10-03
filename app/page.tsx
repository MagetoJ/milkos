'use client';

import { useEffect } from 'react';
import { getSession, homeFor, loginUrl } from '@/lib/auth';

/**
 * Sends each signed-in user to their role's home (lib/auth ROLE_HOME), everyone else to /login.
 * The role here only picks a starting page; each section's layout re-checks it with the backend.
 */
export default function HomePage() {
  useEffect(() => {
    const session = getSession();
    window.location.replace(session ? homeFor(session.role) : loginUrl());
  }, []);

  return (
    <div className="flex h-screen items-center justify-center text-sm text-[#5E6B64]">
      <p>Loading…</p>
    </div>
  );
}
