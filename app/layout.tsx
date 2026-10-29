import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegistrar } from '@/components/offline/service-worker'

export const metadata: Metadata = {
  title: 'MilkOS — Collection OS',
  description: 'The operating system for modern milk collection networks.',
  applicationName: 'MilkOS',
  appleWebApp: { capable: true, title: 'MilkOS', statusBarStyle: 'default' },
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

