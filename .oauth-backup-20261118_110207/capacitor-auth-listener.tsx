'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

export function CapacitorAuthListener() {
  useEffect(() => {
    let listenerHandle: any;

    const setup = async () => {
      listenerHandle = await App.addListener('appUrlOpen', async ({ url }) => {
        // url: milkos://oauth/callback?code=...&state=...
        if (url.startsWith('milkos://oauth/callback')) {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          const state = parsed.searchParams.get('state');

          // Close the browser tab that @capacitor/browser opened
          await Browser.close();

          // Hand the code to your existing token-exchange logic
          // e.g. exchangeCodeForToken(code, state)
        }
      });
    };

    setup();

    return () => {
      listenerHandle?.remove();
    };
  }, []);

  return null;
}