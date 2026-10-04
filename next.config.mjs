/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Identifies the build: the service worker URL carries it, so each deployment installs a new worker.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? `0.1.0-${Date.now().toString(36)}`,
  },
  async headers() {
    return [
      {
        // The service worker must always be re-checked, never served stale from the HTTP cache.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        // "http://backend:8000" in Docker (set as a build arg); local `pnpm dev` hits the local backend
        destination: `${process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8000'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;