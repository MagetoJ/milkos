'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import AuthShell from '../components/AuthShell';
import { useAuth } from '../components/AuthProvider';
import { getSupabase } from '../../lib/supabase/client';
import { safeNext } from '../../lib/redirect';

type Enrollment = { factorId: string; qrCode: string; secret: string };

function MfaForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { refresh, signOut } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const mfa = getSupabase().auth.mfa;
    (async () => {
      try {
        const { data, error: failure } = await mfa.listFactors();
        if (failure) throw failure;
        const verified = data.totp.find((f) => f.status === 'verified');
        if (verified) {
          setFactorId(verified.id);
          return;
        }
        // Clear half-finished enrollments so a fresh QR code can be issued.
        for (const stale of data.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')) {
          await mfa.unenroll({ factorId: stale.id });
        }
        const enrolled = await mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
        if (enrolled.error) throw enrolled.error;
        setFactorId(enrolled.data.id);
        setEnrollment({ factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not start authenticator setup.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError('');
    const { error: failure } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (failure) {
      setBusy(false);
      setError('That code did not match. Check the time on your phone and try again.');
      return;
    }
    await refresh();
    router.replace(next);
  }

  return (
    <AuthShell
      eyebrow="TWO-STEP VERIFICATION"
      title={enrollment ? 'Set up your authenticator' : 'Enter your code'}
      intro={enrollment
        ? 'Managers, accountants and platform staff must use an authenticator app. Scan the code with Google Authenticator, Microsoft Authenticator or similar, then enter the 6-digit code it shows.'
        : 'Open your authenticator app and enter the 6-digit code for MaziwaCollect.'}
    >
      {loading && <p>Loading…</p>}
      {enrollment && (
        <div style={{ display: 'grid', gap: 10, justifyItems: 'start', marginBottom: 12 }}>
          {/* Supabase returns the QR code as an SVG data URL. */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} />
          <small>Can&apos;t scan? Enter this key instead: <code>{enrollment.secret}</code></small>
        </div>
      )}
      {!loading && factorId && (
        <form className="auth-form" onSubmit={submit}>
          <label>6-digit code<input inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </form>
      )}
      {!loading && !factorId && error && <div className="form-error" role="alert">{error}</div>}
      <p className="auth-footnote"><a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a></p>
    </AuthShell>
  );
}

export default function MfaPage() {
  return <Suspense><MfaForm /></Suspense>;
}
