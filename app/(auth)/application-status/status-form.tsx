'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/public/public-shell';
import { Labeled, Notice, field, primary } from '@/components/settings/settings-ui';
import { formatDateTime } from '@/lib/format';

interface Status {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  organisation: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

/** An applicant checks their cooperative application with its reference AND the email they applied with. */
export function StatusForm({ initialReference = '' }: { initialReference?: string }) {
  const [reference, setReference] = useState(initialReference);
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/v1/auth/application-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: reference.trim(), email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(typeof body.detail === 'string' ? body.detail : 'No application matches these details.');
      setResult(body as Status);
    } catch {
      setError("Can't reach MilkOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell title="Application status" subtitle="Check where your cooperative's onboarding application is.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Labeled label="Application reference" hint="Shown when you submitted the application.">
          {(a) => <input {...a} className={`${field} font-mono`} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />}
        </Labeled>
        <Labeled label="Email you applied with">
          {(a) => <input {...a} type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
        </Labeled>
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className={`${primary} w-full`} disabled={busy || reference.trim().length < 8 || !email.includes('@')}>{busy ? 'Checking…' : 'Check status'}</button>
      </form>
      {result && (
        <div className="mt-5 space-y-3" aria-live="polite">
          <Notice tone={result.status === 'APPROVED' ? 'success' : result.status === 'REJECTED' ? 'danger' : 'info'}>
            <strong>{result.organisation}</strong>:{' '}
            {result.status === 'PENDING' && 'awaiting review by the MilkOS team.'}
            {result.status === 'APPROVED' && 'approved. Sign in with the email and password you chose when applying.'}
            {result.status === 'REJECTED' && `not approved${result.rejection_reason ? `: ${result.rejection_reason}` : '.'}`}
          </Notice>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-mo-muted">Submitted</dt><dd className="text-right">{result.submitted_at ? formatDateTime(result.submitted_at) : '–'}</dd>
            {result.reviewed_at && <><dt className="text-mo-muted">Reviewed</dt><dd className="text-right">{formatDateTime(result.reviewed_at)}</dd></>}
          </dl>
          {result.status === 'APPROVED' && <Link href="/login" className={`${primary} w-full`}>Sign in</Link>}
        </div>
      )}
    </PublicShell>
  );
}
