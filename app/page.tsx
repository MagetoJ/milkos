'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const APK_URL = process.env.NEXT_PUBLIC_APK_URL ?? '/milkos.apk';

export default function LandingPage() {
  const router = useRouter();
  const [isNative, setIsNative] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const cap = (window as any).Capacitor;
    const native = cap?.isNativePlatform?.() ?? false;
    setIsNative(native);
    if (native) {
      router.replace('/login');
      return;
    }

    const ua = navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [router]);

  const handleInstallPWA = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  };

  if (isNative === null) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-900">Welcome to MilkOS</h1>
          <p className="text-gray-600 mt-2">Choose how you want to use MilkOS</p>
        </header>

        <div className="grid md:grid-cols-2 gap-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
              </svg>
              <h2 className="text-xl font-semibold text-gray-900">Android App (APK)</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Best for collectors in the field. Full offline support, Bluetooth scale &amp; printer integration.
            </p>
            <ul className="text-sm text-gray-700 space-y-1 mb-6">
              <li>✅ Works fully offline</li>
              <li>✅ Bluetooth scale + receipt printer</li>
              <li>✅ Native performance</li>
            </ul>
            <a
              href={APK_URL}
              download
              className="mt-auto inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 transition"
            >
              Download APK
            </a>
            <p className="text-xs text-gray-500 mt-3">
              Requires Android 7.0+. Enable “Install from unknown sources”.
            </p>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
              <h2 className="text-xl font-semibold text-gray-900">Web App (PWA)</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              No install required. Works in your browser and can be added to your home screen.
            </p>
            <ul className="text-sm text-gray-700 space-y-1 mb-6">
              <li>✅ No installation needed</li>
              <li>✅ Works on iOS, Android &amp; desktop</li>
              <li>✅ Automatic updates</li>
            </ul>

            {installPrompt ? (
              <button
                onClick={handleInstallPWA}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 transition"
              >
                Install PWA
              </button>
            ) : isIOS ? (
              <div className="text-sm bg-gray-50 border border-gray-200 p-3 rounded-lg">
                On iOS: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </div>
            ) : isStandalone ? (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Already installed
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Open in Chrome or Safari to install this app.
              </p>
            )}

            <a
              href="/login"
              className="mt-auto inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-800 font-medium hover:bg-gray-50 transition"
            >
              Continue in browser →
            </a>
          </section>
        </div>
      </div>
    </main>
  );
}
