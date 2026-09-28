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
      // Decode JWT payload (base64)
      const payloadBase64 = token.split('.')[1];
      const decodedPayload = JSON.parse(atob(payloadBase64));

      if (decodedPayload.role !== 'SUPER_ADMIN') {
        router.replace('/login');
      } else {
        setIsAuthorized(true);
      }
    } catch {
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