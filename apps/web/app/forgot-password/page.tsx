'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import AuthShell from '../components/AuthShell';
import { getSupabase } from '../../lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`;
    const { error: failure } = await getSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setBusy(false);
    // Rate limits are worth surfacing; anything else gets the same answer so accounts cannot be enumerated.
    if (failure && failure.status === 429) setError('Too many requests. Wait a minute and try again.');
    else setSent(true);
  }

  return (
    <AuthShell eyebrow="ACCOUNT RECOVERY" title="Reset your password" intro="Enter the email you sign in with and we will send you a reset link.">
      {sent ? (
        <div className="application-receipt" role="status">
          <span className="receipt-check">✓</span>
          <div><strong>Check your email</strong><p>If an account uses {email}, a reset link is on its way. Open it in this browser.</p><Link href="/login">Back to sign in</Link></div>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <p className="auth-footnote"><Link href="/login">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
