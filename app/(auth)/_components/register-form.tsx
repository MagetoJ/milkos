'use client';

import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
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

const inputClass = (invalid: boolean) =>
  `w-full px-3 py-2 text-sm bg-zinc-800 border rounded-lg text-white placeholder-zinc-500 outline-none focus:border-emerald-500 ${
    invalid ? 'border-red-500' : 'border-zinc-700'
  }`;

// Page order, so we can focus the first field with an error.
const FIELD_ORDER: (keyof OnboardingForm)[] = [
  'cooperative_name', 'registration_number', 'kra_pin', 'county', 'location', 'estimated_daily_liters',
  'initial_coolers_count', 'admin_full_name', 'admin_id_number', 'admin_email', 'admin_phone', 'password',
  'confirm_password', 'additional_info',
];

export function RegisterForm() {
  const [form, setForm] = useState<OnboardingForm>(blankForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof OnboardingForm, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function update(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const name = e.target.name as keyof OnboardingForm;
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
    const name = e.target.name as keyof OnboardingForm;
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
        setSubmitted(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const serverErrors =
        res.status >= 500 && !data.detail
          ? { form: `The Milkflow service is unavailable (HTTP ${res.status}). Please try again shortly.` }
          : errorsFromApi(data.detail);
      setErrors(serverErrors);
      focusFirstError(serverErrors);
    } catch {
      setErrors({ form: 'Could not reach Milkflow. Check your connection and try again.' });
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-700/50 bg-emerald-900/50 text-xl font-bold text-emerald-400">
          ✓
        </div>
        <h3 className="text-lg font-bold text-white">Application submitted</h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-zinc-300">
          A Milkflow administrator will review <strong className="text-white">{form.cooperative_name.trim()}</strong>. Once
          approved, sign in with <strong className="text-white">{form.admin_email.trim().toLowerCase()}</strong> and the
          password you chose.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          Return to sign in
        </Link>
      </div>
    );
  }

  const field = (name: keyof OnboardingForm, label: string, input: ReactNode, hint?: string) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-zinc-300">
        {label}
      </label>
      {input}
      {errors[name] ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-400">
          {errors[name]}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );

  const text = (name: keyof OnboardingForm, placeholder: string, props: Record<string, unknown> = {}) => (
    <input
      id={name}
      name={name}
      value={form[name]}
      onChange={update}
      onBlur={blur}
      placeholder={placeholder}
      aria-invalid={!!errors[name]}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
      className={inputClass(!!errors[name])}
      {...props}
    />
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5 text-left">
      {errors.form && (
        <div role="alert" className="rounded-lg border border-red-800/80 bg-red-950/50 p-3 text-sm text-red-300">
          {errors.form}
        </div>
      )}

      <fieldset className="space-y-3 border-b border-zinc-800 pb-5">
        <legend className="mb-2 text-sm font-semibold text-emerald-400">Cooperative</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field('cooperative_name', 'Official name', text('cooperative_name', 'Limuru Dairy Farmers Co-op'))}
          {field('registration_number', 'Registration number', text('registration_number', 'CS/12345'), 'As printed on the certificate')}
          {field('kra_pin', 'KRA PIN', text('kra_pin', 'P051234567Z', { autoCapitalize: 'characters' }))}
          {field(
            'county',
            'County',
            <select
              id="county"
              name="county"
              value={form.county}
              onChange={update}
              onBlur={blur}
              aria-invalid={!!errors.county}
              className={inputClass(!!errors.county)}
            >
              <option value="">Choose a county…</option>
              {KENYAN_COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>,
          )}
          {field('location', 'Town / sub-county', text('location', 'Limuru'))}
          <div className="grid grid-cols-2 gap-3">
            {field('estimated_daily_liters', 'Milk per day (litres)', text('estimated_daily_liters', '4500', { inputMode: 'decimal' }), 'Optional')}
            {field('initial_coolers_count', 'Coolers', text('initial_coolers_count', '3', { inputMode: 'numeric' }), 'Optional')}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-b border-zinc-800 pb-5">
        <legend className="mb-2 text-sm font-semibold text-emerald-400">Administrator</legend>
        <p className="-mt-1 text-xs text-zinc-400">This person will manage the cooperative on Milkflow and register its farmers and collectors.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field('admin_full_name', 'Full name', text('admin_full_name', 'Jane Wanjiku', { autoComplete: 'name' }))}
          {field('admin_id_number', 'National ID number', text('admin_id_number', '28491029', { inputMode: 'numeric' }))}
          {field('admin_email', 'Email', text('admin_email', 'admin@limurudairy.co.ke', { type: 'email', autoComplete: 'email' }))}
          {field('admin_phone', 'Mobile number', text('admin_phone', '0712 345 678', { type: 'tel', autoComplete: 'tel' }))}
          {field('password', 'Password', text('password', 'At least 8 characters', { type: 'password', autoComplete: 'new-password' }), '8+ characters with a number and a capital letter')}
          {field('confirm_password', 'Confirm password', text('confirm_password', 'Type it again', { type: 'password', autoComplete: 'new-password' }))}
        </div>
      </fieldset>

      {field(
        'additional_info',
        'Anything else we should know? (optional)',
        <textarea
          id="additional_info"
          name="additional_info"
          value={form.additional_info}
          onChange={update}
          rows={3}
          maxLength={2000}
          placeholder="e.g. number of members, collection routes"
          className={inputClass(false)}
        />,
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
      >
        {loading ? 'Submitting application…' : 'Submit application'}
      </button>

      <p className="pt-1 text-center text-xs text-zinc-400">
        Farmers and collectors are registered by their cooperative.{' '}
        <Link href="/login" className="font-semibold text-emerald-400 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
