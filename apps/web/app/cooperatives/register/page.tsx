'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import AuthShell from '../../components/AuthShell';
import { useAuth } from '../../components/AuthProvider';
import { apiFetch } from '../../../lib/api';

type Step = 'details' | 'code' | 'done';
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');
const digits = (value: string) => value.replace(/\D/g, '');

export default function Register() {
  const { me } = useAuth();
  const [step, setStep] = useState<Step>('details');
  const [form, setForm] = useState({ name: '', registrationNumber: '', phone: '', email: '', location: '' });
  const [verificationId, setVerificationId] = useState('');
  const [code, setCode] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  const phone = normalizePhone(form.phone);
  // A phone number the applicant signed in with is already verified by Supabase.
  const phoneAlreadyVerified = Boolean(me?.user.phone && digits(me.user.phone) === digits(phone));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    const result = await apiFetch<{ reference: string }>('/cooperatives/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.trim(),
        phone,
        registrationNumber: form.registrationNumber.trim() || undefined,
        email: form.email.trim() || undefined,
        location: form.location.trim() || undefined,
      }),
    });
    setReference(result.reference);
    setStep('done');
  }

  function submitDetails(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (phoneAlreadyVerified) {
        await submitApplication();
        return;
      }
      const started = await apiFetch<{ verificationId: string; delivery: string }>('/cooperatives/registration/verify/start', {
        method: 'POST',
        body: JSON.stringify({ channel: 'PHONE', destination: phone }),
      });
      setVerificationId(started.verificationId);
      setNotice(started.delivery === 'simulated'
        ? 'SMS is in simulation mode on this server, so no text was sent. Configure an SMS provider to receive codes.'
        : `We sent a 6-digit code to ${phone}.`);
      setStep('code');
    });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await apiFetch('/cooperatives/registration/verify/confirm', {
        method: 'POST',
        body: JSON.stringify({ verificationId, code: code.trim() }),
      });
      await submitApplication();
    });
  }

  if (step === 'done') {
    return (
      <AuthShell eyebrow="APPLICATION SUBMITTED" title="Your cooperative is under review" wide>
        <div className="application-receipt" role="status">
          <span className="receipt-check">✓</span>
          <div>
            <strong>Reference {reference}</strong>
            <p>A platform administrator will review the application. Once it is approved you become the cooperative&apos;s manager and can sign in to run it.</p>
            <Link href="/applications/status">Track this application</Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="COOPERATIVE ONBOARDING"
      title="Register your cooperative"
      intro={`You are applying as ${me?.user.displayName || 'the signed-in user'}. You will manage the cooperative once a platform administrator approves it.`}
      wide
    >
      {step === 'details' ? (
        <form className="auth-form application-form" onSubmit={submitDetails}>
          <label>Cooperative name<input required minLength={2} value={form.name} onChange={set('name')} placeholder="e.g. Mogor Smart Farms" /></label>
          <div className="field-pair">
            <div><label>Registration number <span>(optional)</span></label><input value={form.registrationNumber} onChange={set('registrationNumber')} /></div>
            <div><label>Location <span>(optional)</span></label><input value={form.location} onChange={set('location')} placeholder="County or town" /></div>
          </div>
          <div className="field-pair">
            <div>
              <label>Contact phone</label>
              <input type="tel" required value={form.phone} onChange={set('phone')} placeholder="+2547XXXXXXXX" />
              <p className="field-hint">{phoneAlreadyVerified ? 'Verified when you signed in.' : 'We will text a code to confirm this number.'}</p>
            </div>
            <div><label>Contact email <span>(optional)</span></label><input type="email" value={form.email} onChange={set('email')} placeholder="manager@example.com" /></div>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : phoneAlreadyVerified ? 'Submit application' : 'Verify phone'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitCode}>
          {notice && <div className="success" role="status"><span>{notice}</span></div>}
          <label>SMS code<input inputMode="numeric" required minLength={4} maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Verify and submit'}</button>
          <button className="button-quiet" type="button" onClick={() => { setStep('details'); setCode(''); setError(''); }}>Change details</button>
        </form>
      )}
      <p className="auth-footnote">Applications stay pending until a Platform Super Admin approves them. <Link href="/applications/status">Track an application</Link></p>
    </AuthShell>
  );
}
