import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegistrar } from '@/components/offline/service-worker'
import { BluetoothProvider } from '@/lib/bluetooth/bluetooth-context'
import NativeApiOrigin from '@/components/native/native-api-origin'
import NativeGoogleOAuth from '@/components/native/native-google-oauth'

export const metadata: Metadata = {
  title: 'MilkOS — Collection OS',
  description: 'The operating system for modern milk collection networks.',
  applicationName: 'MilkOS',
  appleWebApp: {
    capable: true,
    title: 'MilkOS',
    statusBarStyle: 'default',
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
      <body className="antialiased min-h-screen bg-gray-50">
        <link rel="manifest" href="/manifest.webmanifest" />
        <BluetoothProvider>
          <NativeApiOrigin />
          <NativeGoogleOAuth />
          {children}
          <ServiceWorkerRegistrar />
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </BluetoothProvider>
      </body>
    </html>
  )
}
