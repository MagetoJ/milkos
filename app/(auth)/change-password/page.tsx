'use client';

// Forced password change. The server refuses every other request from an account flagged must_change_password
// (core/access.py); this page is where such an account lands after signing in.
import { useEffect, useState, type FormEvent } from 'react';
import { PublicShell } from '@/components/public/public-shell';
import { Labeled, Notice, PasswordChecklist, field, primary } from '@/components/settings/settings-ui';
import { PASSWORD_RULES, changePassword, passwordProblems } from '@/lib/account/api';
import { ApiError } from '@/lib/api-client';
import { getSession, homeFor, loginUrl } from '@/lib/auth';

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getSession()) window.location.replace(loginUrl('/change-password'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setError('The two passwords are different.');
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      const session = getSession();
      window.location.assign(session ? homeFor(session.role) : '/login');
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell title="Choose a new password" subtitle="Your account needs a new password before you can continue.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Labeled label="Current password">
          {(a) => <input {...a} type="password" autoComplete="current-password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />}
        </Labeled>
        <Labeled label="New password">
          {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={next} onChange={(e) => setNext(e.target.value)} />}
        </Labeled>
        <Labeled label="Repeat new password">
          {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        </Labeled>
        <PasswordChecklist value={next} rules={PASSWORD_RULES} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className={`${primary} w-full`} disabled={busy || !current || passwordProblems(next).length > 0 || !repeat}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </PublicShell>
  );
}
