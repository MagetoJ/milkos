/** @type {import('next').NextConfig} */
const nextConfig = {
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
