'use client';

// Password reset from the SMS link (token in the URL fragment, never sent to a server, removed once read).
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/public/public-shell';
import { Labeled, Notice, PasswordChecklist, field, primary } from '@/components/settings/settings-ui';
import { PASSWORD_RULES, completeReset, forgetTokenInLocation, inspectReset, passwordProblems, tokenFromLocation, type LinkState } from '@/lib/account/api';
import { ApiError } from '@/lib/api-client';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<LinkState | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = tokenFromLocation();
    forgetTokenInLocation();
    setToken(t);
    if (!t) return setState('INVALID');
    inspectReset(t).then((r) => { setState(r.state); setPhone(r.phone_masked ?? ''); }, () => setState('INVALID'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError('The two passwords are different.');
    setBusy(true);
    setError('');
    try {
      await completeReset(token!, password);
      window.location.assign('/login?reset=1');
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setState('EXPIRED');
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return <PublicShell title="Choose a new password"><p role="status" className="text-sm text-mo-muted">Checking your link…</p></PublicShell>;
  if (state !== 'VALID') {
    return (
      <PublicShell title="Choose a new password">
        <div className="space-y-4">
          <Notice tone="warn">{state === 'EXPIRED' ? 'This reset link has expired.' : state === 'USED' ? 'This reset link has already been used.' : 'This reset link isn’t valid.'}</Notice>
          <Link href="/forgot-password" className={`${primary} w-full`}>Request a new link</Link>
        </div>
      </PublicShell>
    );
  }
  const problems = passwordProblems(password);
  return (
    <PublicShell title="Choose a new password" subtitle={phone ? <>For the account on <span className="font-mono">{phone}</span>.</> : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Labeled label="New password">
          {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
        </Labeled>
        <Labeled label="Repeat password">
          {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        </Labeled>
        <PasswordChecklist value={password} rules={PASSWORD_RULES} />
        <p className="text-sm text-mo-muted">Every device signed in to this account will be signed out.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className={`${primary} w-full`} disabled={busy || problems.length > 0 || !repeat}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </PublicShell>
  );
}
