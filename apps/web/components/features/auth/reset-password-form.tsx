'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { FormField } from './form-field';
import { passwordRule } from './password-rules';

const schema = z.object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

/** Used after a recovery link and by invited users choosing their first password. */
export function ResetPasswordForm({ invited }: { invited: boolean }) {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
  }, []);

  const submit = form.handleSubmit(async ({ password }) => {
    setError('');
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError?.code === 'insufficient_aal') {
      // Accounts with MFA must verify their authenticator before changing the password.
      router.replace(`/auth/mfa?next=${encodeURIComponent(`/reset-password${invited ? '?invited=1' : ''}`)}`);
      return;
    }
    if (updateError) {
      setError(updateError.code === 'same_password'
        ? 'Choose a password you have not used before.'
        : updateError.code === 'reauthentication_needed'
          ? 'For security, request a new reset link and try again.'
          : 'We could not update your password. Try again.');
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  });

  if (hasSession === null) return <Skeleton className="h-40 w-full" />;
  if (!hasSession) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          This link has expired or was already used.{' '}
          <Link href="/forgot-password" className="font-medium underline">Request a new reset link</Link>.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="m-0 grid gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormField id="password" label={invited ? 'Choose a password' : 'New password'} error={errors.password?.message} hint="At least 10 characters with upper- and lower-case letters and a number.">
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register('password')} />
      </FormField>
      <FormField id="confirm" label="Confirm password" error={errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register('confirm')} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        {invited ? 'Set password and continue' : 'Update password'}
      </Button>
    </form>
  );
}
