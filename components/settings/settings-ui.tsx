'use client';

// Building blocks shared by every role's settings screens (desktop workspaces and the mobile apps).
import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleCheck, CloudOff, Lock, TriangleAlert } from 'lucide-react';

export const field =
  'w-full rounded-lg border border-mo-line-strong bg-mo-surface px-3 py-2.5 text-base text-mo-ink outline-none sm:text-sm ' +
  'placeholder:text-mo-subtle focus:border-mo-brand focus:ring-2 focus:ring-mo-brand/20 disabled:bg-mo-canvas disabled:text-mo-subtle ' +
  'aria-[invalid=true]:border-mo-danger';
export const primary =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-mo-brand px-4 text-sm font-semibold text-white outline-none ' +
  'hover:bg-mo-brand-strong focus-visible:ring-2 focus-visible:ring-mo-brand/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const secondary =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-mo-line-strong bg-mo-surface px-4 text-sm font-medium text-mo-ink outline-none ' +
  'hover:bg-mo-hover focus-visible:ring-2 focus-visible:ring-mo-brand/40 disabled:cursor-not-allowed disabled:opacity-60';
export const danger =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-mo-danger-line bg-mo-surface px-4 text-sm font-medium text-mo-danger outline-none ' +
  'hover:bg-mo-danger-soft focus-visible:ring-2 focus-visible:ring-mo-danger/30 disabled:cursor-not-allowed disabled:opacity-60';

export function SettingsCard({ id, title, description, children, action }: {
  id?: string; title: string; description?: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 rounded-xl border border-mo-line bg-mo-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-mo-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-mo-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-mo-muted">{description}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Labeled({ label, hint, error, children }: {
  label: string; hint?: ReactNode; error?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-mo-ink">{label}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': error || hint ? noteId : undefined })}
      {error ? (
        <p id={noteId} role="alert" className="mt-1 text-sm text-mo-danger">{error}</p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-sm text-mo-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/** A labelled on/off switch (role="switch": announced as on/off, not as a checkbox). */
export function Toggle({ label, help, checked, disabled, lockedNote, onChange }: {
  label: string; help?: string; checked: boolean; disabled?: boolean; lockedNote?: string; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-mo-ink">{label}</label>
        {(help || lockedNote) && (
          <p id={`${id}-help`} className="mt-0.5 text-sm text-mo-muted">
            {lockedNote ? <span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3.5" />{lockedNote}</span> : help}
          </p>
        )}
      </div>
      <button
        id={id} type="button" role="switch" aria-checked={checked} aria-describedby={help || lockedNote ? `${id}-help` : undefined}
        disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent outline-none transition-colors
          focus-visible:ring-2 focus-visible:ring-mo-brand/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60
          ${checked ? 'bg-mo-brand' : 'bg-mo-line-strong'}`}
      >
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
        <span aria-hidden className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

/** A value the cooperative or the platform controls: shown, never editable here. */
export function LockedValue({ label, value, note = 'Managed by your cooperative' }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-sm text-mo-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-mo-ink">
        {value || <span className="text-mo-subtle">Not set</span>}
        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-mo-subtle">
          <Lock aria-hidden className="size-3" />
          <span>{note}</span>
        </span>
      </dd>
    </div>
  );
}

export function ValueRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-sm text-mo-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-mo-ink">{value || <span className="text-mo-subtle">Not set</span>}</dd>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warn' | 'danger'; children: ReactNode }) {
  const styles = {
    info: 'border-mo-info/20 bg-mo-info-soft text-mo-info',
    success: 'border-mo-brand/20 bg-mo-brand-soft text-mo-brand',
    warn: 'border-mo-warn/20 bg-mo-warn-soft text-mo-warn',
    danger: 'border-mo-danger-line bg-mo-danger-soft text-mo-danger',
  }[tone];
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? null : TriangleAlert;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      {Icon && <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Shown on security actions while offline: they need the server, so they're disabled, not queued. */
export function NeedsConnection({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-mo-warn">
      <CloudOff aria-hidden className="size-4" />
      Needs a connection. This can&apos;t be done offline.
    </p>
  );
}

/** One-time code entry: numeric keyboard, autofill from the SMS where the phone supports it. */
export function CodeInput({ value, onChange, label = 'Verification code', error, autoFocus }: {
  value: string; onChange: (value: string) => void; label?: string; error?: string; autoFocus?: boolean;
}) {
  return (
    <Labeled label={label} error={error} hint="6 digits, from the SMS we just sent.">
      {(a11y) => (
        <input
          {...a11y} value={value} autoFocus={autoFocus} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${field} max-w-48 text-center font-mono text-xl tracking-[0.4em]`}
        />
      )}
    </Labeled>
  );
}

/** Seconds left before something may be requested again (resend cooldowns). */
export function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!seconds) return;
    const until = Date.now() + seconds * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}

export function PasswordChecklist({ value, rules }: { value: string; rules: { test: (v: string) => boolean; label: string }[] }) {
  return (
    <ul aria-label="Password requirements" className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
      {rules.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.label} className={`flex items-center gap-1.5 ${ok ? 'text-mo-brand' : 'text-mo-muted'}`}>
            <CircleCheck aria-hidden className={`size-4 ${ok ? '' : 'opacity-40'}`} />
            <span>{r.label}</span>
            <span className="sr-only">{ok ? '(done)' : '(not yet)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
