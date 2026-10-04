import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegistrar } from '@/components/offline/service-worker'

export const metadata: Metadata = {
  title: 'MilkOS — Collection OS',
  description: 'The operating system for modern milk collection networks.',
  generator: 'v0.app',
  applicationName: 'MilkOS',
  appleWebApp: { capable: true, title: 'MilkOS', statusBarStyle: 'default' },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistrar />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

