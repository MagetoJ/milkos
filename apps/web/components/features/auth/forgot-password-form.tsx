'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MailCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { FormField } from './form-field';

const schema = z.object({ email: z.string().trim().email('Enter a valid email address') });

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ email }) => {
    await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    // Always show the same confirmation so the form cannot be used to discover accounts.
    setSent(true);
  });

  if (sent) {
    return (
      <Alert variant="success">
        <MailCheck />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>If an account exists for that address, a password reset link is on its way. The link expires in one hour.</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="m-0 grid gap-4">
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} {...form.register('email')} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
