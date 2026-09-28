'use client';

import { useState, type FormEvent } from 'react';
import { loginUser } from '../_api/auth-client';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await loginUser({ email, password });
      
      if (!result.success) {
        setError(result.message || 'Sign in failed.');
        return;
      }

      // Check role and redirect to the correct dashboard
      if (result.role === 'SUPER_ADMIN') {
        window.location.assign('/superadmin');
      } else if (result.role === 'COOP_ADMIN' || result.role === 'MANAGER') {
        window.location.assign('/cooperatives');
      } else {
        window.location.assign('/collections');
      }
    } catch {
      setError('Unable to reach the Milkflow API. Check that the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Email address
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="superadmin@milkflow.com"
          className="h-11 w-full rounded-lg border px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Password
        </label>
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

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-11 w-full rounded-lg bg-[#176044] text-sm font-bold text-white transition hover:bg-[#207650] disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}