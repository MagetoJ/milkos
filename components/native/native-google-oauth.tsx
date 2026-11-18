'use client';

import { navigate } from '@/lib/navigation';
import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  CHANGE_PASSWORD_PATH,
  postLoginRedirect,
  saveToken,
  type UserRole,
} from '@/lib/auth';
import { provisionDevice } from '@/lib/offline/auth';

const CALLBACK_PROTOCOL = 'com.milkos.app:';
const CALLBACK_HOST = 'auth';
const CALLBACK_PATH = '/google/callback';
const NEXT_KEY = 'milkos_google_oauth_next';

const VALID_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'COOP_ADMIN',
  'MANAGER',
  'COLLECTOR',
  'FARMER',
];

interface ExchangeResponse {
  access_token?: string;
  role?: UserRole;
  user_id?: string;
  must_change_password?: boolean;
}

function redirectToLogin(reason: 'cancelled' | 'failed' | 'mfa') {
  const params = new URLSearchParams();

  if (reason === 'mfa') {
    params.set('mfa_required', '1');
  } else {
    params.set('google_error', reason);
  }

  navigate(`/login?${params.toString()}`, 'replace');
}

export default function NativeGoogleOAuth() {
  const handledCallbacks = useRef(new Set<string>());

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;

    async function handleCallback(rawUrl: string) {
      let callback: URL;

      try {
        callback = new URL(rawUrl);
      } catch {
        return;
      }

      if (
        callback.protocol !== CALLBACK_PROTOCOL ||
        callback.hostname !== CALLBACK_HOST ||
        callback.pathname !== CALLBACK_PATH
      ) {
        return;
      }

      if (handledCallbacks.current.has(rawUrl)) return;
      handledCallbacks.current.add(rawUrl);

      try {
        await Browser.close();
      } catch {
        // The browser may already have closed.
      }

      const params = callback.searchParams;

      if (params.get('mfa_required') === '1') {
        sessionStorage.removeItem(NEXT_KEY);
        redirectToLogin('mfa');
        return;
      }

      const callbackError = params.get('error');

      if (callbackError) {
        sessionStorage.removeItem(NEXT_KEY);
        redirectToLogin(
          callbackError === 'google_signin_cancelled' ? 'cancelled' : 'failed',
        );
        return;
      }

      const ticket = params.get('ticket');

      if (!ticket || ticket.length < 20) {
        sessionStorage.removeItem(NEXT_KEY);
        redirectToLogin('failed');
        return;
      }

      try {
        const response = await fetch('/api/v1/auth/google/native/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket }),
        });

        const result = (await response.json().catch(() => ({}))) as ExchangeResponse;

        if (
          !response.ok ||
          !result.access_token ||
          !result.role ||
          !VALID_ROLES.includes(result.role)
        ) {
          sessionStorage.removeItem(NEXT_KEY);
          redirectToLogin('failed');
          return;
        }

        saveToken(result.access_token);

        try {
          await provisionDevice(result.access_token);
        } catch {
          // Device provisioning can be retried by the workspace.
        }

        const next = sessionStorage.getItem(NEXT_KEY);
        sessionStorage.removeItem(NEXT_KEY);

        if (result.must_change_password) {
          navigate(CHANGE_PASSWORD_PATH, 'replace');
          return;
        }

        navigate(postLoginRedirect(result.role, next), 'replace');
      } catch {
        sessionStorage.removeItem(NEXT_KEY);
        redirectToLogin('failed');
      }
    }

    async function registerListener() {
      try {
        const registration = await App.addListener('appUrlOpen', ({ url }) => {
          void handleCallback(url);
        });

        if (disposed) {
          await registration.remove();
          return;
        }

        listener = registration;

        const launch = await App.getLaunchUrl();

        if (!disposed && launch?.url) {
          await handleCallback(launch.url);
        }
      } catch {
        // Avoid crashing the application if native listener setup fails.
      }
    }

    void registerListener();

    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  return null;
}
