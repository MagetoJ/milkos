'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { loginUser } from '../_api/auth-client';
import { CHANGE_PASSWORD_PATH, getSession, homeFor, postLoginRedirect, saveToken, type UserRole } from '@/lib/auth';
import { verifyMfaLogin } from '@/lib/account/api';
import { ApiError } from '@/lib/api-client';
import { provisionDevice } from '@/lib/offline/auth';

const inputClass =
  'h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-base sm:text-sm !text-white placeholder-zinc-400 outline-none ' +
  'focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/40 [-webkit-text-fill-color:white]';

export function LoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session) {
      window.location.replace(homeFor(session.role));
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('registered') === '1') setNotice('Application submitted. Please wait for Superadmin approval.');
    if (params.get('activated') === '1') setNotice('Your account is active. Sign in with your new password.');
    if (params.get('reset') === '1') setNotice('Your password has been changed. Sign in with the new one.');
    if (params.get('mfa_required') === '1') setNotice('Your account uses two-step verification. Sign in with your password to continue.');
  }, []);

  async function finish(token: string, role: UserRole, mustChange: boolean) {
    saveToken(token);
    // Set this device up for offline use (best effort; the workspace retries if it fails).
    await provisionDevice(token);
    if (mustChange) return window.location.assign(CHANGE_PASSWORD_PATH);
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.assign(postLoginRedirect(role, next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setErrorCode(undefined);
    setIsSubmitting(true);
    try {
      const result = await loginUser({ identifier, password });
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
        setPassword('');
        return;
      }
      if (!result.success || !result.role || !result.token) {
        setError(result.message || 'Sign in failed.');
        setErrorCode(result.code);
        return;
      }
      await finish(result.token, result.role, !!result.mustChangePassword);
    } catch {
      setError('Unable to reach the MilkOS API. Check that the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaToken) return;
    setError('');
    setIsSubmitting(true);
    try {
      const result = await verifyMfaLogin(mfaToken, code.trim());
      await finish(result.access_token, result.role, result.must_change_password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign in failed.');
      if (e instanceof ApiError && e.status === 401) {
        setMfaToken(null);
        setCode('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mfaToken) {
    return (
      <form onSubmit={handleMfa} className="space-y-4 text-white" noValidate>
        <div>
          <h2 className="text-base font-bold">Two-step verification</h2>
          <p className="mt-1 text-sm text-zinc-300">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
        <div>
          <label htmlFor="mfa-code" className="mb-1 block text-xs font-bold text-white">Code</label>
          <input
            id="mfa-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code"
            inputMode="text" className={`${inputClass} text-center font-mono text-lg tracking-widest`}
            aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined}
          />
        </div>
        {error && <p id="login-error" role="alert" className="text-sm font-medium text-red-300">{error}</p>}
        <button type="submit" disabled={isSubmitting || code.trim().length < 6}
          className="h-11 w-full rounded-lg bg-emerald-700 text-sm font-bold text-white transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60">
          {isSubmitting ? 'Checking…' : 'Verify and sign in'}
        </button>
        <button type="button" onClick={() => { setMfaToken(null); setCode(''); setError(''); }} className="w-full text-center text-sm text-zinc-300 underline">
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4 text-white">
      <button
        type="button"
        onClick={() => { window.location.href = '/api/v1/auth/google/login'; }}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
          <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z" />
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
          <path fill="#FBBC05" d="M5.6 14.8c-.3-.8-.4-1.8-.4-2.8s.1-2 .4-2.8L1.9 6.3C.7 8.8 0 10.3 0 12s.7 3.2 1.9 5.7l3.7-2.9z" />
          <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
        </svg>
        <span>Sign in with Google</span>
      </button>

      <div className="relative my-4 flex items-center justify-center">
        <div className="w-full border-t border-zinc-800" />
        <span className="absolute bg-zinc-950 px-3 text-xs font-semibold uppercase text-zinc-300">Or continue with</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="login-identifier" className="mb-1 block text-xs font-bold text-white">Email or phone number</label>
          <input
            id="login-identifier" required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com or 0712 345 678" className={inputClass}
            aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="login-password" className="block text-xs font-bold text-white">Password</label>
            <Link href="/forgot-password" className="text-xs font-semibold text-emerald-300 underline-offset-2 hover:underline">Forgot password?</Link>
          </div>
          <input
            id="login-password" type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className={inputClass}
          />
        </div>

        {notice && <p role="status" className="text-sm font-medium text-emerald-300">{notice}</p>}
        {error && (
          <div id="login-error" role="alert" className="space-y-1 text-sm font-medium text-red-300">
            <p>{error}</p>
            {errorCode === 'activation_required' && (
              <Link href="/activate-account?resend=1" className="font-bold text-white underline">Send me a new activation link</Link>
            )}
            {errorCode === 'locked' && <Link href="/forgot-password" className="font-bold text-white underline">Reset your password</Link>}
          </div>
        )}

        <button
          type="submit" disabled={isSubmitting}
          className="h-11 w-full rounded-lg bg-emerald-700 text-sm font-bold text-white transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="pt-2 text-center text-xs text-zinc-300">
          Registering a new cooperative?{' '}
          <Link href="/register" className="font-bold text-white underline hover:text-emerald-300">Apply for onboarding</Link>
          {' · '}
          <Link href="/application-status" className="font-bold text-white underline hover:text-emerald-300">Check an application</Link>
        </p>
      </form>
    </div>
  );
}
