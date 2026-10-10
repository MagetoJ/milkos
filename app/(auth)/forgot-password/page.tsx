'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/public/public-shell';
import { Labeled, Notice, field, primary } from '@/components/settings/settings-ui';
import { requestPasswordReset } from '@/lib/account/api';
import { ApiError } from '@/lib/api-client';

/** Password reset request. The answer never says whether an account exists. */
export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSent((await requestPasswordReset(identifier.trim())).message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell title="Reset your password" subtitle="We’ll text a reset link to the phone number on your account.">
      {sent ? (
        <div className="space-y-4">
          <Notice tone="success">{sent}</Notice>
          <p className="text-sm text-mo-muted">
            Haven&apos;t activated your account yet? Use the activation link from your first SMS, or{' '}
            <Link href="/activate-account" className="font-medium text-mo-brand underline">request a new activation link</Link>.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Labeled label="Email or phone number">
            {(a) => <input {...a} className={field} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus />}
          </Labeled>
          {error && <Notice tone="danger">{error}</Notice>}
          <button type="submit" className={`${primary} w-full`} disabled={busy || identifier.trim().length < 3}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <p className="text-center text-sm"><Link href="/login" className="text-mo-brand underline">Back to sign in</Link></p>
        </form>
      )}
    </PublicShell>
  );
}
