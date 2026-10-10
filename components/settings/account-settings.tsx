'use client';

// Personal account settings, shared by every role: profile, phone (code-verified), password, two-step verification,
// notifications, work preferences, sessions & devices and the account's security history.
//
// Each role sees only what applies to it (the server returns the role's notification catalog, the fields it may
// edit and its work preferences, and re-checks every change). Profile and preferences are cached for offline
// viewing; security actions are online-only and are disabled, never queued, without a connection.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Laptop, LogOut, Phone, ShieldCheck, Smartphone } from 'lucide-react';
import {
  PASSWORD_RULES, changePassword, confirmPhone, disableMfa, enableMfa, getAccount, getPreferences, getSecurityEvents,
  listSessions, newRecoveryCodes, passwordProblems, requestPhoneChange, requestPhoneVerification, revokeOtherSessions,
  revokeSession, savePreferences, startMfa, updateProfile,
  type AccountProfile, type CodeSent, type Preferences, type SecurityEvent, type SessionInfo,
} from '@/lib/account/api';
import { cacheAccount, readCachedAccount } from '@/lib/account/cache';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, humanize } from '@/lib/format';
import { getDeviceId } from '@/lib/offline/device';
import { useIsOnline } from '@/lib/sync/hooks';
import {
  CodeInput, Labeled, LockedValue, NeedsConnection, Notice, PasswordChecklist, SettingsCard, Toggle, ValueRow, danger, field,
  primary, secondary, useCountdown,
} from './settings-ui';

export type SectionKey = 'profile' | 'phone' | 'password' | 'mfa' | 'notifications' | 'work' | 'sessions' | 'activity';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Platform administrator', COOP_ADMIN: 'Cooperative administrator', MANAGER: 'Manager',
  COLLECTOR: 'Collector', FARMER: 'Farmer',
};

const PROFILE_LABELS: Record<string, string> = {
  collector_number: 'Collector number', assigned_area: 'Assigned area', centre_name: 'Collection centre',
  cooler_name: 'Default cooler', farmer_number: 'Member number', village: 'Location', number_of_cows: 'Number of cows',
  payment_method: 'Payment method', payment_account_masked: 'Payment account', bank_name: 'Bank', member_since: 'Member since',
  collector_status: 'Collector status', farmer_status: 'Membership status',
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
}

function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fields : {};
}

// ---------------- data ----------------

export function useAccountData() {
  const online = useIsOnline();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, q] = await Promise.all([getAccount(), getPreferences()]);
      setProfile(p);
      setPrefs(q);
      setFromCache(false);
      void cacheAccount(p.id, { profile: p, preferences: q });
    } catch (e) {
      // Offline: show the last copy saved on this device (profile and preferences only).
      const session = typeof window !== 'undefined' ? (await import('@/lib/auth')).getSession() : null;
      const cached = session?.userId ? await readCachedAccount(session.userId) : null;
      if (cached?.profile) {
        setProfile(cached.profile);
        setPrefs(cached.preferences);
        setFromCache(true);
      } else {
        setError(message(e));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, online]);

  return { profile, setProfile, prefs, setPrefs, error, fromCache, online, reload: load };
}

function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    getDeviceId().then(setId, () => setId(null));
  }, []);
  return id;
}

// ---------------- sections ----------------

function ProfileSection({ profile, online, onSaved }: { profile: AccountProfile; online: boolean; onSaved: (p: AccountProfile) => void }) {
  const [name, setName] = useState(profile.full_name);
  const [email, setEmail] = useState(profile.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const emailChanged = (email.trim() || null) !== (profile.email ?? null);
  const dirty = name.trim() !== profile.full_name || emailChanged;
  const extra = Object.entries(profile.profile).filter(([k, v]) => PROFILE_LABELS[k] && v !== null && v !== '');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice('');
    try {
      const updated = await updateProfile({
        ...(name.trim() !== profile.full_name ? { full_name: name.trim() } : {}),
        ...(emailChanged ? (email.trim() ? { email: email.trim() } : { clear_email: true }) : {}),
        ...(emailChanged ? { current_password: password } : {}),
      });
      onSaved(updated);
      setPassword('');
      setNotice('Saved.');
    } catch (err) {
      setErrors({ ...fieldErrors(err), form: Object.keys(fieldErrors(err)).length ? '' : message(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="profile" title="Profile" description="How you appear in MilkOS.">
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {profile.editable.full_name ? (
            <Labeled label="Full name" error={errors.full_name}>
              {(a) => <input {...a} className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={!online} />}
            </Labeled>
          ) : (
            <dl><LockedValue label="Full name" value={profile.full_name} /></dl>
          )}
          <Labeled label={`Email${profile.editable.email_required ? '' : ' (optional)'}`} error={errors.email}>
            {(a) => <input {...a} type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={!online} />}
          </Labeled>
        </div>
        {emailChanged && (
          <Labeled label="Current password" hint="Needed to change your sign-in email." error={errors.current_password}>
            {(a) => <input {...a} type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
          </Labeled>
        )}
        <dl className="divide-y divide-mo-line border-t border-mo-line">
          <ValueRow label="Role" value={ROLE_LABEL[profile.role] ?? humanize(profile.role)} />
          {profile.cooperative && <LockedValue label="Cooperative" value={`${profile.cooperative.name} (${profile.cooperative.code})`} />}
          {extra.map(([k, v]) => (
            <LockedValue key={k} label={PROFILE_LABELS[k]} value={k === 'member_since' ? formatDateTime(String(v)) : String(v)} />
          ))}
          <ValueRow label="Account status" value={humanize(profile.account_status)} />
          <ValueRow label="Last sign-in" value={profile.last_login_at ? formatDateTime(profile.last_login_at) : null} />
        </dl>
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primary} disabled={!dirty || busy || !online}>{busy ? 'Saving…' : 'Save profile'}</button>
          <NeedsConnection online={online} />
        </div>
      </form>
    </SettingsCard>
  );
}

function PhoneSection({ profile, online, deviceId, onSaved }: {
  profile: AccountProfile; online: boolean; deviceId: string | null; onSaved: (p: AccountProfile) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'change' | 'code'>('idle');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<CodeSent | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const wait = useCountdown(pending?.resend_after_seconds ?? null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    try {
      await fn();
    } catch (e) {
      const f = fieldErrors(e);
      setErrors(Object.keys(f).length ? f : { form: message(e) });
    } finally {
      setBusy(false);
    }
  }

  const sendChange = () => run(async () => {
    const sent = await requestPhoneChange(phone, password);
    setPending(sent);
    setPassword('');
    setMode('code');
    if (!sent.sms_sent) setErrors({ form: `We couldn't send the code: ${sent.sms_error ?? 'try again shortly.'}` });
  });
  const sendVerify = () => run(async () => {
    const sent = await requestPhoneVerification();
    setPending(sent);
    setMode('code');
    if (!sent.sms_sent) setErrors({ form: `We couldn't send the code: ${sent.sms_error ?? 'try again shortly.'}` });
  });
  const confirm = () => run(async () => {
    if (!pending) return;
    const updated = await confirmPhone(pending.verification_id, code, deviceId);
    onSaved(updated);
    setDone(updated.phone !== profile.phone ? 'Your phone number has been changed. Other devices were signed out.' : 'Your phone number is verified.');
    setMode('idle');
    setPending(null);
    setCode('');
    setPhone('');
  });

  return (
    <SettingsCard id="phone" title="Phone number" description="Used to sign in and for activation, verification and password-reset messages.">
      <dl className="divide-y divide-mo-line">
        <ValueRow label="Number" value={<span className="font-mono">{profile.phone_masked}</span>} />
        <ValueRow label="Status" value={profile.phone_verified ? (
          <span className="inline-flex items-center gap-1 text-mo-brand"><ShieldCheck aria-hidden className="size-4" />Verified {profile.phone_verified_at ? formatDateTime(profile.phone_verified_at) : ''}</span>
        ) : <span className="text-mo-warn">Not verified</span>} />
      </dl>
      {done && <div className="mt-3"><Notice tone="success">{done}</Notice></div>}
      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!profile.phone_verified && <button className={primary} disabled={!online || busy} onClick={sendVerify}><Phone aria-hidden className="size-4" />Verify this number</button>}
          <button className={secondary} disabled={!online} onClick={() => { setMode('change'); setDone(''); }}>Change number</button>
        </div>
      )}
      {mode === 'change' && (
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void sendChange(); }} noValidate>
          <p className="text-sm text-mo-muted">We&apos;ll send a code to the new number. Your current number stays until you enter it.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="New phone number" hint="e.g. 0712 345 678" error={errors.phone}>
              {(a) => <input {...a} type="tel" inputMode="tel" autoComplete="tel" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Labeled>
            <Labeled label="Current password" error={errors.password}>
              {(a) => <input {...a} type="password" autoComplete="current-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Labeled>
          </div>
          {errors.form && <Notice tone="danger">{errors.form}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={!phone || !password || busy || !online}>{busy ? 'Sending…' : 'Send code'}</button>
            <button type="button" className={secondary} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </form>
      )}
      {mode === 'code' && pending && (
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void confirm(); }} noValidate>
          <p className="text-sm text-mo-muted" aria-live="polite">
            {pending.sms_sent ? <>We sent a code to <strong className="font-mono">{pending.phone_masked}</strong>.</> : 'The code could not be sent yet.'}
          </p>
          <CodeInput value={code} onChange={setCode} error={errors.code} autoFocus />
          {errors.form && <Notice tone="danger">{errors.form}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={primary} disabled={code.length !== 6 || busy || !online}>{busy ? 'Checking…' : 'Confirm'}</button>
            <button type="button" className={secondary} disabled={wait > 0 || busy || !online}
              onClick={() => (phone ? setMode('change') : void sendVerify())}>
              {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
            </button>
            <button type="button" className={secondary} onClick={() => { setMode('idle'); setPending(null); }}>Cancel</button>
          </div>
        </form>
      )}
      <NeedsConnection online={online} />
    </SettingsCard>
  );
}

function PasswordSection({ profile, online, deviceId }: { profile: AccountProfile; online: boolean; deviceId: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = passwordProblems(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setErrors({ repeat: 'The two passwords are different.' });
    setBusy(true);
    setErrors({});
    try {
      await changePassword(current, next, deviceId);
      setDone(true);
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(Object.keys(f).length ? f : { form: message(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="password" title="Password"
      description={profile.password_set_at ? `Last changed ${formatDateTime(profile.password_set_at)}.` : 'Choose a password only you know.'}>
      {profile.must_change_password && <div className="mb-4"><Notice tone="warn">You must choose a new password before you can continue.</Notice></div>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Labeled label="Current password" error={errors.current_password}>
          {(a) => <input {...a} type="password" autoComplete="current-password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Labeled>
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="New password" error={errors.new_password}>
            {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={next} onChange={(e) => setNext(e.target.value)} />}
          </Labeled>
          <Labeled label="Repeat new password" error={errors.repeat}>
            {(a) => <input {...a} type="password" autoComplete="new-password" className={field} value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
          </Labeled>
        </div>
        <PasswordChecklist value={next} rules={PASSWORD_RULES} />
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        {done && <Notice tone="success">Password changed. Your other sessions were signed out.</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primary} disabled={!current || problems.length > 0 || !repeat || busy || !online}>
            <KeyRound aria-hidden className="size-4" />{busy ? 'Changing…' : 'Change password'}
          </button>
          <NeedsConnection online={online} />
        </div>
      </form>
    </SettingsCard>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-2">
      <Notice tone="warn">Save these recovery codes somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.</Notice>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg border border-mo-line bg-mo-canvas p-3 font-mono text-sm sm:grid-cols-4">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <button type="button" className={secondary} onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copy codes</button>
    </div>
  );
}

function MfaSection({ profile, online, onChanged }: { profile: AccountProfile; online: boolean; onChanged: () => void }) {
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'codes' | 'disable' | 'regenerate'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      const f = fieldErrors(e);
      setError(f.code || f.password || message(e));
    } finally {
      setBusy(false);
    }
  }
  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setSecret(null); setError(''); };

  return (
    <SettingsCard id="mfa" title="Two-step verification"
      description="A code from an authenticator app is asked for after your password, so a stolen password alone isn't enough.">
      <p className="mb-4 text-sm">
        Status: <strong className={profile.mfa_enabled ? 'text-mo-brand' : 'text-mo-muted'}>{profile.mfa_enabled ? 'On' : 'Off'}</strong>
        {profile.mfa_enabled && <span className="text-mo-muted"> · {profile.recovery_codes_left} recovery codes left</span>}
      </p>
      {step === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {!profile.mfa_enabled && <button className={primary} disabled={!online} onClick={() => setStep('password')}><ShieldCheck aria-hidden className="size-4" />Turn on</button>}
          {profile.mfa_enabled && <button className={secondary} disabled={!online} onClick={() => setStep('regenerate')}>New recovery codes</button>}
          {profile.mfa_enabled && <button className={danger} disabled={!online} onClick={() => setStep('disable')}>Turn off</button>}
        </div>
      )}
      {step === 'password' && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { setSecret(await startMfa(password)); setPassword(''); setStep('scan'); }); }}>
          <Labeled label="Confirm your password">
            {(a) => <input {...a} type="password" autoComplete="current-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Labeled>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex gap-2"><button className={primary} disabled={!password || busy}>Continue</button><button type="button" className={secondary} onClick={reset}>Cancel</button></div>
        </form>
      )}
      {step === 'scan' && secret && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await enableMfa(code); setCodes(r.recovery_codes); setStep('codes'); onChanged(); }); }}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-mo-ink">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
            <li>Add an account with this setup key, or <a className="font-medium text-mo-brand underline" href={secret.otpauth_uri}>open it in the app</a> on this phone:
              <code className="mt-1 block break-all rounded bg-mo-canvas px-2 py-1.5 font-mono text-sm">{secret.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <CodeInput value={code} onChange={setCode} label="Code from the app" autoFocus />
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex gap-2"><button className={primary} disabled={code.length !== 6 || busy}>Turn on</button><button type="button" className={secondary} onClick={reset}>Cancel</button></div>
        </form>
      )}
      {step === 'codes' && (
        <div className="space-y-3">
          <Notice tone="success">Two-step verification is on.</Notice>
          <RecoveryCodes codes={codes} />
          <button className={primary} onClick={() => { setCodes([]); reset(); }}>I&apos;ve saved them</button>
        </div>
      )}
      {(step === 'disable' || step === 'regenerate') && (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (step === 'disable') { await disableMfa(password, code); onChanged(); reset(); }
            else { const r = await newRecoveryCodes(password, code); setCodes(r.recovery_codes); setStep('codes'); onChanged(); }
          });
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Password">
              {(a) => <input {...a} type="password" autoComplete="current-password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Labeled>
            <Labeled label="Code from the app (or a recovery code)">
              {(a) => <input {...a} inputMode="text" autoComplete="one-time-code" className={field} value={code} onChange={(e) => setCode(e.target.value.trim())} />}
            </Labeled>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex gap-2">
            <button className={step === 'disable' ? danger : primary} disabled={!password || code.length < 6 || busy}>{step === 'disable' ? 'Turn off' : 'Create new codes'}</button>
            <button type="button" className={secondary} onClick={reset}>Cancel</button>
          </div>
        </form>
      )}
      <NeedsConnection online={online} />
    </SettingsCard>
  );
}

function NotificationsSection({ prefs, online, onSaved }: { prefs: Preferences; online: boolean; onSaved: (p: Preferences) => void }) {
  const [error, setError] = useState('');
  async function toggle(key: string, value: boolean) {
    setError('');
    try {
      onSaved(await savePreferences({ notifications: { [key]: value } }));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <SettingsCard id="notifications" title="Notifications" description="What MilkOS tells you about in the app.">
      <div className="divide-y divide-mo-line">
        {prefs.notifications.map((n) => (
          <Toggle key={n.key} label={n.label} help={n.help} checked={n.enabled} disabled={n.mandatory || !online}
            lockedNote={n.mandatory ? 'Required for your account’s safety' : undefined} onChange={(v) => void toggle(n.key, v)} />
        ))}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {!online && <p className="mt-2 text-sm text-mo-warn">Connect to change notification settings.</p>}
    </SettingsCard>
  );
}

export interface WorkOption { id: string; name: string }

const WORK_LABELS: Record<string, { label: string; help?: string }> = {
  dashboard_range: { label: 'Default dashboard period' },
  table_density: { label: 'Table density' },
  default_centre_id: { label: 'Default collection centre' },
  default_cooler_id: { label: 'Default cooler' },
  confirm_before_submit: { label: 'Review before confirming a collection', help: 'Show the summary step before saving.' },
  scale_auto_capture: { label: 'Capture the weight when it is stable', help: 'Saves a tap when the scale reports a stable reading.' },
  receipt_preview: { label: 'Show the SMS receipt preview', help: 'See what the farmer will receive before confirming.' },
};

function WorkSection({ prefs, online, options, onSaved }: {
  prefs: Preferences; online: boolean; options?: { centres?: WorkOption[]; coolers?: WorkOption[] }; onSaved: (p: Preferences) => void;
}) {
  const [error, setError] = useState('');
  const keys = Object.keys(prefs.work);
  if (!keys.length) return null;
  async function save(key: string, value: unknown) {
    setError('');
    try {
      onSaved(await savePreferences({ work: { [key]: value } }));
    } catch (e) {
      setError(fieldErrors(e)[key] ?? message(e));
    }
  }
  return (
    <SettingsCard id="work" title="Work preferences" description="Defaults that save you time. They only affect you.">
      <div className="divide-y divide-mo-line">
        {keys.map((key) => {
          const value = prefs.work[key];
          const meta = WORK_LABELS[key] ?? { label: humanize(key) };
          if (typeof value === 'boolean') {
            return <Toggle key={key} label={meta.label} help={meta.help} checked={value} disabled={!online} onChange={(v) => void save(key, v)} />;
          }
          const choices: { value: string; label: string }[] =
            key === 'dashboard_range' ? [{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '3m', label: 'Last 3 months' }]
            : key === 'table_density' ? [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]
            : key === 'default_centre_id' ? [{ value: '', label: 'No default' }, ...(options?.centres ?? []).map((c) => ({ value: c.id, label: c.name }))]
            : key === 'default_cooler_id' ? [{ value: '', label: 'No default' }, ...(options?.coolers ?? []).map((c) => ({ value: c.id, label: c.name }))]
            : [];
          return (
            <div key={key} className="py-3">
              <Labeled label={meta.label}>
                {(a) => (
                  <select {...a} className={`${field} sm:max-w-xs`} value={(value as string) ?? ''} disabled={!online}
                    onChange={(e) => void save(key, e.target.value || null)}>
                    {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                )}
              </Labeled>
            </div>
          );
        })}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </SettingsCard>
  );
}

function describeDevice(s: SessionInfo): string {
  if (s.label) return s.label;
  const ua = s.user_agent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return [browser, os].filter(Boolean).join(' on ') || s.platform || 'Unknown device';
}

function SessionsSection({ online, deviceId }: { online: boolean; deviceId: string | null }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    if (!online) return;
    listSessions(deviceId).then(setSessions, (e) => setError(message(e)));
  }, [online, deviceId]);
  useEffect(load, [load]);

  async function revoke(s: SessionInfo) {
    if (!window.confirm(`Sign out ${describeDevice(s)}?`)) return;
    try {
      const r = await revokeSession(s.id, deviceId);
      if (r.signed_out_here) return window.location.assign('/login');
      setNotice('That device was signed out.');
      load();
    } catch (e) {
      setError(message(e));
    }
  }
  async function others() {
    if (!window.confirm('Sign out every other device? Unsynced changes on those devices stay there until someone signs in again.')) return;
    try {
      const r = await revokeOtherSessions(deviceId);
      setNotice(`${r.revoked} other session${r.revoked === 1 ? '' : 's'} signed out.`);
      load();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <SettingsCard id="sessions" title="Sessions & devices" description="Where your account is signed in. Location isn't tracked."
      action={<button className={secondary} disabled={!online || !sessions || sessions.length < 2} onClick={() => void others()}><LogOut aria-hidden className="size-4" />Sign out other devices</button>}>
      {!online && <p className="text-sm text-mo-warn">Connect to see and manage your sessions.</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <div className="mb-3"><Notice tone="success">{notice}</Notice></div>}
      {online && sessions && sessions.length === 0 && <p className="text-sm text-mo-muted">No devices are set up for offline use. Your current browser session ends when you sign out.</p>}
      <ul className="divide-y divide-mo-line">
        {(sessions ?? []).map((s) => {
          const Icon = /Android|iPhone|iPad|Mobile/.test(s.user_agent ?? '') || /android|ios/i.test(s.platform ?? '') ? Smartphone : Laptop;
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-mo-muted" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-mo-ink">
                    {describeDevice(s)} {s.current && <span className="ml-1 rounded-full bg-mo-brand-soft px-2 py-0.5 text-xs font-semibold text-mo-brand">This device</span>}
                  </p>
                  <p className="text-sm text-mo-muted">
                    Last active {s.last_active_at ? formatDateTime(s.last_active_at) : 'unknown'}
                    {s.last_sync_at ? ` · Last sync ${formatDateTime(s.last_sync_at)}` : ''}
                    {!s.device_active ? ' · Device deactivated' : ''}
                  </p>
                </div>
              </div>
              <button className={secondary} disabled={!online} onClick={() => void revoke(s)} aria-label={`Sign out ${describeDevice(s)}`}>Sign out</button>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

function ActivitySection({ online }: { online: boolean }) {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!online) return;
    getSecurityEvents(30).then(setEvents, (e) => setError(message(e)));
  }, [online]);
  return (
    <SettingsCard id="activity" title="Security activity" description="Sign-ins and changes to your account. If something looks wrong, change your password.">
      {!online && <p className="text-sm text-mo-warn">Connect to see your security activity.</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {events && events.length === 0 && <p className="text-sm text-mo-muted">Nothing yet.</p>}
      <ol className="divide-y divide-mo-line">
        {(events ?? []).map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
            <span className={`font-medium ${/FAILED|LOCKED|SUSPICIOUS|BLOCKED/.test(e.action) ? 'text-mo-danger' : 'text-mo-ink'}`}>{e.label}</span>
            <span className="text-mo-muted">{e.created_at ? formatDateTime(e.created_at) : ''}{e.ip_address ? ` · ${e.ip_address}` : ''}</span>
          </li>
        ))}
      </ol>
    </SettingsCard>
  );
}

// ---------------- the page ----------------

export const DEFAULT_SECTIONS: SectionKey[] = ['profile', 'phone', 'password', 'mfa', 'notifications', 'work', 'sessions', 'activity'];

const NAV_LABEL: Record<SectionKey, string> = {
  profile: 'Profile', phone: 'Phone', password: 'Password', mfa: 'Two-step', notifications: 'Notifications', work: 'Preferences',
  sessions: 'Devices', activity: 'Activity',
};

export function AccountSettings({ sections = DEFAULT_SECTIONS, workOptions, before, after, compact = false }: {
  sections?: SectionKey[];
  workOptions?: { centres?: WorkOption[]; coolers?: WorkOption[] };
  /** Role-specific panels shown above / below the personal sections. */
  before?: ReactNode;
  after?: ReactNode;
  /** Phone layout: no side navigation. */
  compact?: boolean;
}) {
  const { profile, setProfile, prefs, setPrefs, error, fromCache, online, reload } = useAccountData();
  const deviceId = useDeviceId();
  const visible = useMemo(() => sections.filter((s) => s !== 'work' || (prefs && Object.keys(prefs.work).length > 0)), [sections, prefs]);
  const saveProfile = useCallback((p: AccountProfile) => {
    setProfile(p);
    void cacheAccount(p.id, { profile: p });
  }, [setProfile]);
  const savePrefs = useCallback((p: Preferences) => {
    setPrefs(p);
    if (profile) void cacheAccount(profile.id, { preferences: p });
  }, [setPrefs, profile]);

  if (error && !profile) return <Notice tone="danger">{error} <button className="ml-1 font-medium underline" onClick={() => void reload()}>Try again</button></Notice>;
  if (!profile) return <p role="status" className="text-sm text-mo-muted">Loading your settings…</p>;

  return (
    <div className={compact ? 'space-y-4' : 'grid gap-6 lg:grid-cols-[12rem_1fr]'}>
      {!compact && (
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {visible.map((s) => (
              <li key={s}><a href={`#${s}`} className="block rounded-md px-3 py-2 text-sm text-mo-muted hover:bg-mo-hover hover:text-mo-ink">{NAV_LABEL[s]}</a></li>
            ))}
          </ul>
        </nav>
      )}
      <div className="min-w-0 space-y-4">
        {fromCache && <Notice tone="warn">You&apos;re offline. Showing the settings saved on this device; changes need a connection.</Notice>}
        {before}
        {visible.includes('profile') && <ProfileSection key={profile.id + profile.full_name + (profile.email ?? '')} profile={profile} online={online && !fromCache} onSaved={saveProfile} />}
        {visible.includes('phone') && <PhoneSection profile={profile} online={online && !fromCache} deviceId={deviceId} onSaved={saveProfile} />}
        {visible.includes('password') && <PasswordSection profile={profile} online={online && !fromCache} deviceId={deviceId} />}
        {visible.includes('mfa') && <MfaSection profile={profile} online={online && !fromCache} onChanged={() => void reload()} />}
        {visible.includes('notifications') && prefs && <NotificationsSection prefs={prefs} online={online && !fromCache} onSaved={savePrefs} />}
        {visible.includes('work') && prefs && <WorkSection prefs={prefs} online={online && !fromCache} options={workOptions} onSaved={savePrefs} />}
        {visible.includes('sessions') && <SessionsSection online={online && !fromCache} deviceId={deviceId} />}
        {visible.includes('activity') && <ActivitySection online={online && !fromCache} />}
        {after}
      </div>
    </div>
  );
}
