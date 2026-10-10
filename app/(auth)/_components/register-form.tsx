'use client';

import { useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, Copy } from 'lucide-react';
import { Labeled, Notice, field, primary, secondary } from '@/components/settings/settings-ui';
import {
  KENYAN_COUNTIES,
  blankForm,
  errorsFromApi,
  toPayload,
  validateAll,
  validateField,
  type FieldErrors,
  type OnboardingForm,
} from '../_lib/onboarding-rules';

type Name = keyof OnboardingForm;

// The three parts of the application, in page order. `required` drives the progress indicator.
const STEPS: { title: string; required: Name[] }[] = [
  { title: 'Organization', required: ['cooperative_name', 'registration_number', 'kra_pin', 'county', 'location'] },
  { title: 'Contact person', required: ['admin_full_name', 'admin_id_number', 'admin_email', 'admin_phone'] },
  { title: 'Password', required: ['password', 'confirm_password'] },
];
// Page order, so we can focus the first field with an error.
const FIELD_ORDER: Name[] = [
  'cooperative_name', 'registration_number', 'kra_pin', 'county', 'location', 'estimated_daily_liters',
  'initial_coolers_count', 'admin_full_name', 'admin_id_number', 'admin_email', 'admin_phone', 'password',
  'confirm_password', 'additional_info',
];

/** Which parts of the application are complete, from the same rules the server mirrors. */
export function applicationProgress(form: OnboardingForm) {
  const steps = STEPS.map((s) => ({ title: s.title, done: s.required.filter((n) => !validateField(n, form)).length, total: s.required.length }));
  const done = steps.reduce((n, s) => n + s.done, 0);
  const total = steps.reduce((n, s) => n + s.total, 0);
  return { steps, done, total };
}

function Progress({ form }: { form: OnboardingForm }) {
  const { steps, done, total } = useMemo(() => applicationProgress(form), [form]);
  const labelId = useId();
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between text-sm">
        <span id={labelId} className="font-medium">Application progress</span>
        <span className="text-mo-muted" aria-live="polite">{done} of {total} required fields done</span>
      </div>
      <div role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        aria-valuetext={`${done} of ${total} required fields done`} className="mt-2 h-2 overflow-hidden rounded-full bg-mo-line">
        <div className="h-full rounded-full bg-mo-brand transition-[width] motion-reduce:transition-none" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-2 text-xs sm:text-sm">
        {steps.map((s, i) => {
          const complete = s.done === s.total;
          return (
            <li key={s.title} className={`flex items-center gap-1.5 ${complete ? 'text-mo-brand' : 'text-mo-muted'}`}>
              <span aria-hidden className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${complete ? 'border-mo-brand bg-mo-brand text-white' : 'border-mo-line-strong'}`}>
                {complete ? <Check className="size-3" /> : i + 1}
              </span>
              <span>{s.title}<span className="sr-only">{complete ? ' (complete)' : ` (${s.done} of ${s.total} done)`}</span></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Submitted({ reference, organization, email }: { reference: string | null; organization: string; email: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      /* clipboard unavailable: the reference stays selectable on screen */
    }
  }
  return (
    <div className="space-y-4 text-center" role="status">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-mo-brand-soft text-mo-brand"><Check aria-hidden className="size-6" /></div>
      <h2 className="text-lg font-semibold">Application submitted</h2>
      <p className="mx-auto max-w-md text-sm text-mo-muted">
        The MilkOS team will review <strong className="text-mo-ink">{organization}</strong>. Once approved, sign in with{' '}
        <strong className="text-mo-ink">{email}</strong> and the password you chose.
      </p>
      {reference && (
        <div className="mx-auto max-w-md rounded-lg border border-mo-line bg-mo-canvas p-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-mo-muted">Your application reference</p>
          <p className="mt-1 break-all font-mono text-sm select-all">{reference}</p>
          <p className="mt-1 text-xs text-mo-muted">Keep this. You need it, with your email, to check the status of your application.</p>
          <button type="button" onClick={copy} className={`${secondary} mt-2`}>
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? 'Copied' : 'Copy reference'}
          </button>
        </div>
      )}
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        {reference && <Link href={`/application-status?reference=${encodeURIComponent(reference)}`} className={primary}>Check application status</Link>}
        <Link href="/login" className={secondary}>Return to sign in</Link>
      </div>
    </div>
  );
}

export function RegisterForm() {
  const [form, setForm] = useState<OnboardingForm>(blankForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<Name, boolean>>>({});
  const [submitted, setSubmitted] = useState<{ reference: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function update(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const name = e.target.name as Name;
    const next = { ...form, [name]: e.target.value };
    setForm(next);
    // Re-validate as they type once a field has been visited (or after a failed submit).
    if (touched[name] || errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: validateField(name, next), form: undefined }));
    }
    if (name === 'password' && (touched.confirm_password || errors.confirm_password)) {
      setErrors((prev) => ({ ...prev, confirm_password: validateField('confirm_password', next) }));
    }
  }

  function blur(e: { target: { name: string } }) {
    const name = e.target.name as Name;
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name, form) }));
  }

  function focusFirstError(errs: FieldErrors) {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clientErrors = validateAll(form);
    if (Object.values(clientErrors).some(Boolean)) {
      setErrors(clientErrors);
      focusFirstError(clientErrors);
      return;
    }

    setLoading(true);
    setErrors({});
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitted({ reference: typeof data.application_id === 'string' ? data.application_id : null });
        return;
      }
      const data = await res.json().catch(() => ({}));
      // Whatever went wrong, the form stays filled in. Users never see a raw HTTP status.
      const serverErrors: FieldErrors =
        res.status >= 500 && !data.detail
          ? { form: 'MilkOS is unavailable right now. Your answers are kept, so please try again in a few minutes.' }
          : errorsFromApi(data.detail);
      setErrors(serverErrors);
      focusFirstError(serverErrors);
    } catch {
      setErrors({ form: 'Could not reach MilkOS. Check your connection and try again. Your answers are kept.' });
    } finally {
      setLoading(false);
    }
  }

  if (submitted) return <Submitted reference={submitted.reference} organization={form.cooperative_name.trim()} email={form.admin_email.trim().toLowerCase()} />;

  /** One labelled input wired to the form state, validation and error display. */
  const input = (name: Name, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <Labeled label={label} hint={hint} error={errors[name]}>
      {(a) => <input {...a} name={name} value={form[name]} onChange={update} onBlur={blur} className={field} {...props} />}
    </Labeled>
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
      <Progress form={form} />
      {errors.form && <Notice tone="danger">{errors.form}</Notice>}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">1. Organization</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input('cooperative_name', 'Organization name', { placeholder: 'Limuru Dairy Farmers Co-op', autoComplete: 'organization' })}
          {input('registration_number', 'Registration number', { placeholder: 'CS/12345' }, 'As printed on the certificate')}
          {input('kra_pin', 'KRA PIN', { placeholder: 'P051234567Z', autoCapitalize: 'characters' })}
          <Labeled label="County" error={errors.county}>
            {(a) => (
              <select {...a} name="county" value={form.county} onChange={update} onBlur={blur} className={field}>
                <option value="">Choose a county…</option>
                {KENYAN_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </Labeled>
          {input('location', 'Location', { placeholder: 'Town or sub-county, e.g. Limuru' })}
          <div className="grid grid-cols-2 gap-3">
            {input('estimated_daily_liters', 'Milk per day (litres)', { placeholder: '4500', inputMode: 'decimal' }, 'Optional')}
            {input('initial_coolers_count', 'Coolers', { placeholder: '3', inputMode: 'numeric' }, 'Optional')}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">2. Contact person</legend>
        <p className="text-sm text-mo-muted">This person will manage the organization on MilkOS and register its farmers and collectors.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input('admin_full_name', 'Name', { placeholder: 'Jane Wanjiku', autoComplete: 'name' })}
          {input('admin_id_number', 'ID number', { placeholder: '28491029', inputMode: 'numeric' }, 'National ID')}
          {input('admin_email', 'Email', { type: 'email', placeholder: 'admin@limurudairy.co.ke', autoComplete: 'email' })}
          {input('admin_phone', 'Phone', { type: 'tel', placeholder: '0712 345 678', autoComplete: 'tel' })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">3. Password</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input('password', 'Password', { type: 'password', autoComplete: 'new-password', placeholder: 'At least 8 characters' }, '8+ characters with a number and a capital letter')}
          {input('confirm_password', 'Confirm password', { type: 'password', autoComplete: 'new-password', placeholder: 'Type it again' })}
        </div>
      </fieldset>

      <Labeled label="Additional information (optional)">
        {(a) => (
          <textarea {...a} name="additional_info" value={form.additional_info} onChange={update} rows={3} maxLength={2000}
            placeholder="e.g. number of members, collection routes" className={field} />
        )}
      </Labeled>

      <button type="submit" disabled={loading} className={`${primary} w-full`}>{loading ? 'Submitting application…' : 'Submit application'}</button>
      <p className="text-center text-sm text-mo-muted">
        Farmers and collectors are registered by their cooperative. <Link href="/login" className="font-semibold text-mo-brand underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
