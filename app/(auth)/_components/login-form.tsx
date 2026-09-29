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
    const session = getSession();
    if (session) {
      window.location.replace(homeFor(session.role));
      return;
    }
    if (new URLSearchParams(window.location.search).get('registered') === '1') {
      setNotice('Application submitted. Please wait for Superadmin approval.');
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

      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(postLoginRedirect(result.role, next));
    } catch {
      setError('Unable to reach the Milkflow API. Check that the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleGoogleSignIn = () => {
    // Redirect to FastAPI Google OAuth endpoint
    window.location.href = '/api/v1/auth/google/login';
  };

  return (
    <div className="space-y-4 text-white">
      {/* Google OAuth Button */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        className="w-full h-11 flex items-center justify-center gap-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm rounded-lg border border-zinc-700 transition"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#EA4335"
            d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"
          />
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
          />
          <path
            fill="#FBBC05"
            d="M5.6 14.8c-.3-.8-.4-1.8-.4-2.8s.1-2 .4-2.8L1.9 6.3C.7 8.8 0 10.3 0 12s.7 3.2 1.9 5.7l3.7-2.9z"
          />
          <path
            fill="#34A853"
            d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"
          />
        </svg>
        <span>Sign in with Google</span>
      </button>

      {/* Divider */}
      <div className="relative flex items-center justify-center my-4">
        <div className="w-full border-t border-zinc-800"></div>
        <span className="absolute bg-zinc-950 px-3 text-xs font-semibold text-zinc-400 uppercase">
          Or continue with
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-white mb-1">Email address</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm !text-white placeholder-zinc-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 [-webkit-text-fill-color:white]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white mb-1">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm !text-white placeholder-zinc-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 [-webkit-text-fill-color:white]"
          />
        </div>

        {notice && <p className="text-xs text-emerald-400 font-medium">{notice}</p>}
        {error && <p role="alert" className="text-xs text-red-400 font-medium">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-11 w-full rounded-lg bg-emerald-700 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-xs text-zinc-300 pt-2">
          Registering a new cooperative?{' '}
          <Link href="/register" className="font-bold text-white underline hover:text-emerald-400">
            Apply for onboarding
          </Link>
        </p>
      </form>
    </div>
  );
}