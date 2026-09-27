'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Loader2, Mail, MessageSquare, KeyRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';
import { FormField } from './form-field';
import { GoogleButton } from './google-button';

type Method = 'password' | 'email' | 'phone';

const passwordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
const emailValue = z.string().trim().email('Enter a valid email address');
const phoneValue = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +254712345678');
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

interface LoginFormProps {
  next: string;
  initialError?: string;
}

export function LoginForm({ next, initialError }: LoginFormProps) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>('password');
  const [error, setError] = useState(initialError || '');
  const [codeTarget, setCodeTarget] = useState<{ kind: 'email' | 'phone'; value: string } | null>(null);

  const finish = () => {
    router.replace(next);
    router.refresh();
  };
  const selectMethod = (m: Method) => {
    setMethod(m);
    setError('');
    setCodeTarget(null);
  };

  const methods: Array<{ id: Method; label: string; icon: typeof KeyRound }> = [
    { id: 'password', label: 'Password', icon: KeyRound },
    { id: 'email', label: 'Email code', icon: Mail },
    ...(env.phoneAuthEnabled ? [{ id: 'phone' as const, label: 'SMS code', icon: MessageSquare }] : []),
  ];

  return (
    <div className="grid gap-5">
      <GoogleButton next={next} onError={setError} />
      <Separator>or</Separator>

      <div role="tablist" aria-label="Sign-in method" className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
        {methods.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={method === id}
            onClick={() => selectMethod(id)}
            className={cn(
              'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors',
              method === id && 'bg-background text-foreground shadow-xs',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {method === 'password' && <PasswordForm onError={setError} onSuccess={finish} />}
      {method !== 'password' && !codeTarget && (
        <RequestCodeForm kind={method === 'phone' ? 'phone' : 'email'} next={next} onError={setError} onSent={setCodeTarget} />
      )}
      {codeTarget && (
        <VerifyCodeForm target={codeTarget} next={next} onError={setError} onSuccess={finish} onChangeTarget={() => setCodeTarget(null)} />
      )}
    </div>
  );
}

function PasswordForm({ onError, onSuccess }: { onError: (m: string) => void; onSuccess: () => void }) {
  const form = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    onError('');
    const { error } = await createClient().auth.signInWithPassword(values);
    if (!error) return onSuccess();
    // Generic wording: never reveal whether the email exists.
    onError(error.code === 'email_not_confirmed'
      ? 'Confirm your email address first — check your inbox for the link.'
      : 'Incorrect email or password.');
  });

  return (
    <form onSubmit={submit} noValidate className="m-0 grid gap-4">
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} {...form.register('email')} />
      </FormField>
      <FormField
        id="password"
        label="Password"
        error={errors.password?.message}
        action={<Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>}
      >
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register('password')} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}

function RequestCodeForm({ kind, next, onError, onSent }: {
  kind: 'email' | 'phone';
  next: string;
  onError: (m: string) => void;
  onSent: (target: { kind: 'email' | 'phone'; value: string }) => void;
}) {
  const form = useForm<{ value: string }>({
    resolver: zodResolver(z.object({ value: kind === 'email' ? emailValue : phoneValue })),
    defaultValues: { value: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ value }) => {
    onError('');
    const { error } = await sendCode(kind, value.trim(), next);
    if (error) {
      onError(error.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'We could not send a code right now. Try again shortly.');
      return;
    }
    onSent({ kind, value: value.trim() });
  });

  return (
    <form onSubmit={submit} noValidate className="m-0 grid gap-4">
      {kind === 'email' ? (
        <FormField id="otp-email" label="Email" error={errors.value?.message} hint="We’ll email you a 6-digit code. New here? This creates your account.">
          <Input id="otp-email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.value} {...form.register('value')} />
        </FormField>
      ) : (
        <FormField id="otp-phone" label="Phone number" error={errors.value?.message} hint="Registered collectors and farmers only.">
          <Input id="otp-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+2547…" aria-invalid={!!errors.value} {...form.register('value')} />
        </FormField>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Send code
      </Button>
    </form>
  );
}

const RESEND_SECONDS = 60;

/** Email codes may create an account (self-service onboarding); phone codes only work for existing users. */
function sendCode(kind: 'email' | 'phone', value: string, next: string) {
  const auth = createClient().auth;
  return kind === 'email'
    ? auth.signInWithOtp({ email: value, options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } })
    : auth.signInWithOtp({ phone: value, options: { shouldCreateUser: false } });
}

function VerifyCodeForm({ target, next, onError, onSuccess, onChangeTarget }: {
  target: { kind: 'email' | 'phone'; value: string };
  next: string;
  onError: (m: string) => void;
  onSuccess: () => void;
  onChangeTarget: () => void;
}) {
  const form = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });
  const { errors, isSubmitting } = form.formState;
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = form.handleSubmit(async ({ code }) => {
    onError('');
    const supabase = createClient();
    const { error } = target.kind === 'email'
      ? await supabase.auth.verifyOtp({ email: target.value, token: code, type: 'email' })
      : await supabase.auth.verifyOtp({ phone: target.value, token: code, type: 'sms' });
    if (error) {
      onError('That code is invalid or has expired.');
      return;
    }
    onSuccess();
  });

  async function resend() {
    const { error } = await sendCode(target.kind, target.value, next);
    onError(error ? 'We could not resend the code. Try again shortly.' : '');
    if (!error) setCooldown(RESEND_SECONDS);
  }

  return (
    <form onSubmit={submit} noValidate className="m-0 grid gap-4">
      <p className="m-0 text-sm text-muted-foreground">
        Enter the code sent to <span className="font-medium text-foreground">{target.value}</span>.{' '}
        <button type="button" onClick={onChangeTarget} className="cursor-pointer font-medium text-primary hover:underline">Change</button>
      </p>
      <FormField id="code" label="Verification code" error={errors.code?.message}>
        <Input
          id="code"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="h-12 text-center font-mono text-xl tracking-[0.5em]"
          aria-invalid={!!errors.code}
          {...form.register('code')}
        />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Verify and sign in
      </Button>
      <Button type="button" variant="ghost" onClick={resend} disabled={cooldown > 0}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
    </form>
  );
}
