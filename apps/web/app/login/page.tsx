'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import AuthShell from '../components/AuthShell';
import { getSupabase } from '../../lib/supabase/client';
import { safeNext } from '../../lib/redirect';

type Method = 'password' | 'phone';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [method, setMethod] = useState<Method>('password');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get('error') || '');
  const [notice, setNotice] = useState('');

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const finish = () => { router.replace(next); router.refresh(); };

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const auth = getSupabase().auth;
      if (mode === 'sign-in') {
        const { error: failure } = await auth.signInWithPassword({ email: email.trim(), password });
        // Generic wording: never reveal whether the address has an account.
        if (failure) throw new Error('Email or password is incorrect, or the email is not confirmed yet.');
        finish();
        return;
      }
      const { data, error: failure } = await auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callbackUrl(), data: fullName.trim() ? { full_name: fullName.trim() } : undefined },
      });
      if (failure) throw new Error(failure.message);
      if (data.session) finish();
      else setNotice('Check your email for a confirmation link, then come back and sign in.');
    });
  }

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const auth = getSupabase().auth;
      const number = phone.replace(/[\s-]/g, '');
      if (!codeSent) {
        const { error: failure } = await auth.signInWithOtp({ phone: number });
        if (failure) throw new Error(failure.message);
        setCodeSent(true);
        setNotice('We sent a 6-digit code by SMS.');
        return;
      }
      const { error: failure } = await auth.verifyOtp({ phone: number, token: code.trim(), type: 'sms' });
      if (failure) throw new Error('That code is not valid or has expired.');
      finish();
    });
  }

  function google() {
    void run(async () => {
      const { error: failure } = await getSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl() } });
      if (failure) throw new Error(failure.message);
    });
  }

  return (
    <AuthShell
      eyebrow={mode === 'sign-in' ? 'SIGN IN' : 'CREATE ACCOUNT'}
      title={mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
      intro={mode === 'sign-in'
        ? 'Sign in to record collections and manage your cooperative.'
        : 'Your account is personal. A cooperative manager can then invite you, or you can register a new cooperative.'}
    >
      <div className="filter-tabs" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" aria-selected={method === 'password'} className={method === 'password' ? 'selected' : ''} onClick={() => { setMethod('password'); setError(''); setNotice(''); }}>Email</button>
        <button type="button" role="tab" aria-selected={method === 'phone'} className={method === 'phone' ? 'selected' : ''} onClick={() => { setMethod('phone'); setError(''); setNotice(''); }}>Phone</button>
      </div>

      {method === 'password' ? (
        <form className="auth-form" onSubmit={submitPassword}>
          {mode === 'sign-up' && <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" maxLength={120} /></label>}
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Password<input type="password" required minLength={mode === 'sign-up' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {notice && <div className="success" role="status"><span>{notice}</span></div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
          <button className="button-quiet" type="button" onClick={google} disabled={busy}>Continue with Google</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitPhone}>
          <label>Phone number<input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547XXXXXXXX" autoComplete="tel" disabled={codeSent} /></label>
          {codeSent && <label>SMS code<input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={8} /></label>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {notice && <div className="success" role="status"><span>{notice}</span></div>}
          <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : codeSent ? 'Verify and sign in' : 'Send code'}</button>
          {codeSent && <button className="button-quiet" type="button" onClick={() => { setCodeSent(false); setCode(''); setNotice(''); }}>Use a different number</button>}
        </form>
      )}

      <p className="auth-footnote">
        {method === 'password' && mode === 'sign-in' && <><Link href="/forgot-password">Forgot your password?</Link> · </>}
        {mode === 'sign-in'
          ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('sign-up'); setMethod('password'); setError(''); }}>Create an account</a></>
          : <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('sign-in'); setError(''); }}>Sign in</a></>}
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
