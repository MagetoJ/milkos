'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Loader2, MailCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { FormField } from './form-field';
import { GoogleButton } from './google-button';
import { passwordRule } from './password-rules';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  password: passwordRule,
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function SignupForm({ next }: { next: string }) {
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { fullName: '', email: '', password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ fullName, email, password }) => {
    setError('');
    const { error: signUpError } = await createClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (signUpError) {
      setError(signUpError.code === 'weak_password'
        ? 'Choose a stronger password — it appears in known data breaches or is too simple.'
        : 'We could not create the account. Check the details and try again.');
      return;
    }
    // Same response whether or not the address was already registered (no account enumeration).
    setSentTo(email);
  });

  if (sentTo) {
    return (
      <Alert variant="success">
        <MailCheck />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>
          We sent a confirmation link to {sentTo}. Open it on this device to finish creating your account.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-5">
      <GoogleButton next={next} onError={setError} />
      <Separator>or</Separator>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="m-0 grid gap-4">
        <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} {...form.register('fullName')} />
        </FormField>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} {...form.register('email')} />
        </FormField>
        <FormField id="password" label="Password" error={errors.password?.message} hint="At least 10 characters with upper- and lower-case letters and a number.">
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register('password')} />
        </FormField>
        <FormField id="confirm" label="Confirm password" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register('confirm')} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </div>
  );
}
