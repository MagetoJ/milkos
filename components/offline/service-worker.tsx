'use client';

import { useEffect, useState } from 'react';

const BUILD = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

/**
 * Registers the service worker (production builds only, so `next dev` hot reload isn't cached) and
 * offers a reload when a new version has been downloaded.
 */
export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD)}`, { scope: '/' })
      .then((registration) => {
        const watch = (worker: ServiceWorker | null) => {
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
          });
        };
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener('updatefound', () => watch(registration.installing));
        // Check for a new version now and then while the app stays open (for the page's lifetime).
        setInterval(() => void registration.update().catch(() => undefined), 30 * 60_000);
      })
      .catch((error) => console.warn('[milkos] service worker registration failed', error));
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-[70] mx-auto flex w-[min(28rem,calc(100vw-2rem))] items-center justify-between gap-3 rounded-lg bg-[#0F3325] px-4 py-3 text-sm text-white shadow-lg">
      <span>A new version of MilkOS is ready.</span>
      <button className="rounded-md bg-[#E8B04B] px-3 py-1 font-medium text-[#0F3325]" onClick={() => waiting.postMessage('SKIP_WAITING')}>
        Reload
      </button>
    </div>
  );
}
