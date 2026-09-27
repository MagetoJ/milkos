'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import AuthShell from '../components/AuthShell';
import { getSupabase } from '../../lib/supabase/client';

function ResetPasswordForm() {
  const router = useRouter();
  const invited = useSearchParams().get('invited') === '1';
  const [ready, setReady] = useState<'checking' | 'yes' | 'no'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const auth = getSupabase().auth;
    (async () => {
      // Links built from Supabase's default email templates put the session in the URL fragment.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      if (accessToken && refreshToken) {
        await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const { data } = await auth.getSession();
      setReady(data.session ? 'yes' : 'no');
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: failure } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (failure) {
      setError(failure.message);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow={invited ? 'ACCEPT INVITATION' : 'ACCOUNT RECOVERY'}
      title={invited ? 'Set your password' : 'Choose a new password'}
      intro={invited ? 'You have been invited to MaziwaCollect. Choose a password to finish setting up your account.' : 'Use at least 8 characters. You will stay signed in on this device.'}
    >
      {ready === 'checking' && <p>Checking your link…</p>}
      {ready === 'no' && (
        <div className="form-error" role="alert">
          This link is invalid or has expired. <Link href="/forgot-password">Request a new one</Link>.
        </div>
      )}
      {ready === 'yes' && (
        <form className="auth-form" onSubmit={submit}>
          <label>New password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm password<input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}
