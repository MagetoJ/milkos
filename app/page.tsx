'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, homeFor, LOGIN_PATH } from '@/lib/auth';

// `/` has no UI of its own: it forwards to the user's dashboard, or to the one login page.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    router.replace(session ? homeFor(session.role) : LOGIN_PATH);
  }, [router]);

  return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">Loading Milkflow…</div>;
}