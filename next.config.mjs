/** @type {import('next').NextConfig} */

// Where the FastAPI backend lives.
//  - Netlify:  the Render service (override with the BACKEND_INTERNAL_URL env var)
//  - Docker:   "http://backend:8000" (passed as a build arg)
//  - Local:    the backend on your machine
const backendUrl = (
  process.env.BACKEND_INTERNAL_URL ??
  (process.env.NETLIFY ? 'https://milkos.onrender.com' : 'http://127.0.0.1:8000')
).replace(/\/+$/, ''); // drop any trailing slash

const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        'framing-unreeling-relax.ngrok-free.dev',
        '*.ngrok-free.dev',
      ],
    },
  },
  // Standalone is for the Docker image; Netlify (which sets NETLIFY=true) packages the app itself.
  output: process.env.NETLIFY ? undefined : 'standalone',
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
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
