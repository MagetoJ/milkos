import type { MetadataRoute } from 'next';

/** Web app manifest: makes MilkOS installable (Android, desktop Chrome/Edge) and start in its own window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'MilkOS — Collection OS',
    short_name: 'MilkOS',
    description: 'Milk collection, farmers and coolers for dairy cooperatives. Works offline.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F6F7F4',
    theme_color: '#0F3325',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
