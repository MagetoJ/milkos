'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Skip protection if we are already on the login page to avoid loops
    if (pathname === '/login') {
      setIsLoading(false);
      return;
    }

    const token = localStorage.getItem('token');

    if (!token) {
      router.replace('/login');
    } else {
      setIsAuthorized(true);
    }
    setIsLoading(false);
  }, [pathname, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading MilkOS...</p>
      </div>
    );
  }

  if (!isAuthorized && pathname !== '/login') {
    return null;
  }

  return <>{children}</>;
}
