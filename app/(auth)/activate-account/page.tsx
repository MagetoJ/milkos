'use client';

// Account activation from the SMS link. The link carries a one-time token in the URL fragment (#t=...), which the
// browser never sends to any server; this page reads it, removes it from the address bar, and posts it to the API.
// Nothing about the account is shown unless the token is valid.
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import { PublicShell } from '@/components/public/public-shell';
import { CodeInput, Labeled, Notice, PasswordChecklist, field, primary, secondary, useCountdown } from '@/components/settings/settings-ui';
import {
  PASSWORD_RULES, completeActivation, forgetTokenInLocation, inspectActivation, passwordProblems, resendActivation,
  sendActivationCode, tokenFromLocation, verifyActivationCode, type ActivationView,
} from '@/lib/account/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, humanize } from '@/lib/format';

const STATE_MESSAGE: Record<string, string> = {
  INVALID: 'This activation link isn’t valid. Check that you opened the whole link from the SMS, or ask for a new one.',
  EXPIRED: 'This activation link has expired.',
  USED: 'This account has already been activated. Sign in with your password.',
  REVOKED: 'This activation link is no longer valid. A newer link may have been sent, or the invitation was withdrawn.',
};

function RequestNewLink({ token, initialMessage }: { token?: string; initialMessage?: string }) {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSent((await resendActivation(token ? { token } : { identifier })).message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Notice tone="success">{sent}</Notice>;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {initialMessage && <p className="text-sm text-mo-muted">{initialMessage}</p>}
      {!token && (
        <Labeled label="Your phone number or email" hint="The one your administrator registered for you.">
          {(a) => <input {...a} className={field} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="text" />}
        </Labeled>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="submit" className={`${primary} w-full`} disabled={busy || (!token && identifier.trim().length < 3)}>
        {busy ? 'Sending…' : 'Request a new activation link'}
      </button>
    </form>
  );
}

export default function ActivateAccountPage() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<ActivationView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [codeSent, setCodeSent] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const wait = useCountdown(codeSent);

  useEffect(() => {
    const t = tokenFromLocation();
    forgetTokenInLocation();
    setToken(t);
    if (!t) return;
    inspectActivation(t).then((v) => { setView(v); setVerified(!!v.otp_verified); }, (e) => setLoadError(e instanceof ApiError ? e.message : 'Try again in a moment.'));
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        setView({ state: 'EXPIRED', can_request_new_link: true });
      }
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () => run(async () => {
    const r = await sendActivationCode(token!);
    setInfo(r.message);
    setCodeSent(r.resend_after_seconds);
    if (!r.sms_sent) setError(r.message);
  });
  const checkCode = (e: FormEvent) => { e.preventDefault(); void run(async () => { await verifyActivationCode(token!, code); setVerified(true); setInfo(''); }); };
  const finish = (e: FormEvent) => {
    e.preventDefault();
    if (password !== repeat) return setError('The two passwords are different.');
    void run(async () => { await completeActivation(token!, password); setDone(true); setPassword(''); setRepeat(''); });
  };

  if (token === null) return <PublicShell title="Activate your account"><p role="status" className="text-sm text-mo-muted">Loading…</p></PublicShell>;

  if (!token) {
    return (
      <PublicShell title="Activate your account" subtitle="Open the link in the SMS from MilkOS, or ask for a new one here.">
        <RequestNewLink initialMessage="We’ll text a new activation link to your registered phone." />
      </PublicShell>
    );
  }

  if (done) {
    return (
      <PublicShell title="Your account is active">
        <div className="space-y-4 text-center">
          <CircleCheck aria-hidden className="mx-auto size-12 text-mo-brand" />
          <p>You can now sign in with your phone number{view?.role && ['SUPER_ADMIN', 'COOP_ADMIN', 'MANAGER'].includes(view.role) ? ' or email' : ''} and the password you just chose.</p>
          <Link href="/login?activated=1" className={`${primary} w-full`}>Sign in</Link>
        </div>
      </PublicShell>
    );
  }

  if (loadError) return <PublicShell title="Activate your account"><Notice tone="danger">{loadError}</Notice></PublicShell>;
  if (!view) return <PublicShell title="Activate your account"><p role="status" className="text-sm text-mo-muted">Checking your link…</p></PublicShell>;

  if (view.state !== 'VALID') {
    return (
      <PublicShell title="Activate your account">
        <div className="space-y-4">
          <Notice tone={view.state === 'USED' ? 'info' : 'warn'}>{STATE_MESSAGE[view.state]}</Notice>
          {view.state === 'USED' ? (
            <Link href="/login" className={`${primary} w-full`}>Sign in</Link>
          ) : view.can_request_new_link ? (
            <RequestNewLink token={token} />
          ) : (
            <RequestNewLink />
          )}
        </div>
      </PublicShell>
    );
  }

  const needsCode = view.requires_otp && !verified;
  const problems = passwordProblems(password);
  return (
    <PublicShell title={`Welcome, ${view.full_name?.split(' ')[0] ?? ''}`} subtitle="Set up your MilkOS account. It takes a minute.">
      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-mo-canvas p-3 text-sm">
        <dt className="text-mo-muted">Account</dt><dd className="text-right font-mono font-medium">{view.phone_masked}</dd>
        <dt className="text-mo-muted">Role</dt><dd className="text-right font-medium">{humanize(view.role)}</dd>
        {view.cooperative_name && <><dt className="text-mo-muted">Cooperative</dt><dd className="text-right font-medium">{view.cooperative_name}</dd></>}
        <dt className="text-mo-muted">Link expires</dt><dd className="text-right font-medium">{view.expires_at ? formatDateTime(view.expires_at) : ''}</dd>
      </dl>

      <ol className="space-y-6">
        {view.requires_otp && (
          <li>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${verified ? 'bg-mo-brand text-white' : 'bg-mo-hover text-mo-ink'}`}>{verified ? '✓' : '1'}</span>
              Confirm your phone
            </h2>
            {verified ? (
              <p className="flex items-center gap-1.5 text-sm text-mo-brand"><ShieldCheck aria-hidden className="size-4" />Phone confirmed.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-mo-muted">We’ll send a 6-digit code to <strong className="font-mono text-mo-ink">{view.phone_masked}</strong>.</p>
                {codeSent === null ? (
                  <button className={`${primary} w-full`} disabled={busy} onClick={() => void sendCode()}>{busy ? 'Sending…' : 'Send code'}</button>
                ) : (
                  <form onSubmit={checkCode} className="space-y-3" noValidate>
                    {info && <p className="text-sm text-mo-muted" aria-live="polite">{info}</p>}
                    <CodeInput value={code} onChange={setCode} autoFocus />
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={primary} disabled={code.length !== 6 || busy}>{busy ? 'Checking…' : 'Confirm code'}</button>
                      <button type="button" className={secondary} disabled={wait > 0 || busy} onClick={() => void sendCode()}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </li>
        )}
        <li aria-disabled={needsCode}>
          <h2 className={`mb-2 flex items-center gap-2 font-semibold ${needsCode ? 'text-mo-subtle' : ''}`}>
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-mo-hover text-xs text-mo-ink">{view.requires_otp ? '2' : '1'}</span>
            Choose your password
          </h2>
          <form onSubmit={finish} className="space-y-3" noValidate>
            <Labeled label="New password">
              {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} disabled={needsCode} />}
            </Labeled>
            <Labeled label="Repeat password">
              {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={needsCode} />}
            </Labeled>
            <PasswordChecklist value={password} rules={PASSWORD_RULES} />
            <p className="text-sm text-mo-muted">Only you will know this password. MilkOS staff and your administrator can&apos;t see it.</p>
            <button type="submit" className={`${primary} w-full`} disabled={needsCode || problems.length > 0 || !repeat || busy}>
              {busy ? 'Activating…' : 'Activate my account'}
            </button>
          </form>
        </li>
      </ol>
      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
    </PublicShell>
  );
}
