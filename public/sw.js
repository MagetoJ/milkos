/* MilkOS service worker: lets the installed app start without a connection.
 *
 * Caches ONLY the application shell: page HTML (which contains no user data - every page is a client
 * shell that loads its data in the browser), Next.js static bundles, icons and the manifest.
 * NEVER cached here: /api/* (accounts, cooperative data, payments, tokens). Private operational data lives
 * in the signed-in user's IndexedDB database, not in this shared cache.
 *
 * The version comes from the registration URL (/sw.js?v=<build>), so every deployment installs a new
 * worker; the page offers "Update available" and activates it on request (SKIP_WAITING).
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `milkos-shell-${VERSION}`;
const STATIC_CACHE = 'milkos-static-v1'; // content-hashed files never change, so they survive updates

const SHELL_PAGES = [
  '/',
  '/login',
  '/cooperatives',
  '/cooperatives/farmers',
  '/cooperatives/centres',
  '/cooperatives/team',
  '/cooperatives/operations',
  '/cooperatives/coolers',
  '/cooperatives/sync',
  '/collections',
  '/superadmin',
];
const SHELL_ASSETS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icon.svg'];

const isStatic = (url) => url.pathname.startsWith('/_next/static/');
const isPrivate = (url) => url.pathname.startsWith('/api/');

/** Cache a page and every /_next/static file its HTML references, so it can render offline. */
async function cachePage(path) {
  const shell = await caches.open(SHELL_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok || res.redirected) return;
  const html = await res.clone().text();
  await shell.put(path, res);
  const assets = new Set();
  for (const match of html.matchAll(/["'(](\/_next\/static\/[^"'()\s]+)["')]/g)) assets.add(match[1]);
  await Promise.all(
    [...assets].map(async (asset) => {
      if (await statics.match(asset)) return;
      try {
        const r = await fetch(asset);
        if (r.ok) await statics.put(asset, r);
      } catch {
        /* fetched again on first use */
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL_ASSETS.map((a) => shell.add(a).catch(() => undefined)));
      await Promise.all(SHELL_PAGES.map((p) => cachePage(p).catch(() => undefined)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('milkos-shell-') && key !== SHELL_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivate(url)) return; // network only, never cached

  // Immutable build files: cache first.
  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Page loads: network first (fresh HTML when online), cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(request);
          if (res.ok && !res.redirected) cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (
            (await cache.match(url.pathname)) ||
            (await cache.match(url.pathname.replace(/\/$/, '') || '/')) ||
            (await cache.match(SHELL_PAGES.find((p) => p !== '/' && url.pathname.startsWith(p)) || '/')) ||
            new Response('<h1>MilkOS is offline</h1><p>Open MilkOS once while online to make it available offline.</p>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // React Server Component payloads for client navigation: network only. When that fails offline,
  // Next.js falls back to a full page navigation, which the handler above serves from the shell.
  if (request.headers.get('RSC') === '1') return;

  // Icons, manifest and other public files: stale-while-revalidate.
  if (SHELL_ASSETS.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(url.pathname);
        const refresh = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(url.pathname, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })(),
    );
  }
});
