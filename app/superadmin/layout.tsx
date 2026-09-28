'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('milkflow_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      // JWT segments are base64url (RFC 7515): map -/_ back to +/ and restore padding before atob
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const decodedPayload = JSON.parse(atob(padded));
      const isExpired = typeof decodedPayload.exp === 'number' && decodedPayload.exp * 1000 < Date.now();

      if (decodedPayload.role !== 'SUPER_ADMIN' || isExpired) {
        localStorage.removeItem('milkflow_token');
        router.replace('/login');
      } else {
        setIsAuthorized(true);
      }
    } catch {
      localStorage.removeItem('milkflow_token');
      router.replace('/login');
    }
  }, [router]);

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm font-medium">
        Verifying platform superadmin credentials...
      </div>
    );
  }

  return <>{children}</>;
}