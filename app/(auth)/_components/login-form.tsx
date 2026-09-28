'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { loginUser } from '../_api/auth-client';
import { getSession, homeFor, postLoginRedirect } from '@/lib/auth';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Already signed in? Skip the form and go straight to the right dashboard.
    const session = getSession();
    if (session) {
      window.location.replace(homeFor(session.role));
      return;
    }
    if (new URLSearchParams(window.location.search).get('registered') === '1') {
      setNotice('Account created. Please sign in.');
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await loginUser({ email, password });

      if (!result.success || !result.role) {
        setError(result.message || 'Sign in failed.');
        return;
      }

      // Role -> dashboard mapping lives in lib/auth.ts (ROLE_HOME). `?next=` is honoured
      // only if it is an internal page this role is allowed to open.
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(postLoginRedirect(result.role, next));
    } catch {
      setError('Unable to reach the Milkflow API. Check that the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Email address</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="h-11 w-full rounded-lg border px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          className="h-11 w-full rounded-lg border px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
        />
      </div>

      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-11 w-full rounded-lg bg-[#176044] text-sm font-bold text-white transition hover:bg-[#207650] disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-center text-xs text-slate-500">
        New farmer or collector?{' '}
        <Link href="/register" className="font-semibold text-emerald-800 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}