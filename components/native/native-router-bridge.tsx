'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { registerRouter } from '@/lib/navigation';

/** Hands the Next.js router to lib/navigation so non-component code (guards, API client) can use it. */
export default function NativeRouterBridge() {
  const router = useRouter();
  useEffect(() => {
    registerRouter(router);
    return () => registerRouter(null);
  }, [router]);
  return null;
}
