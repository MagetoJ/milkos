'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { FormField } from './form-field';
import { ME_QUERY_KEY, useAuth } from './auth-provider';

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your app') });

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string };

/** TOTP step-up: enrols an authenticator on first use, otherwise asks for a code. */
export function MfaPanel({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mfa = createClient().auth.mfa;
      const { data: aal } = await mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === 'aal2') {
        router.replace(next);
        return;
      }
      const { data: factors, error: listError } = await mfa.listFactors();
      if (listError) return !cancelled && setState({ kind: 'error', message: 'Could not load your security settings. Refresh to try again.' });
      const verified = factors.totp[0];
      if (verified) return !cancelled && setState({ kind: 'challenge', factorId: verified.id });

      // Clear abandoned enrolments so a fresh QR code can be issued.
      await Promise.all(factors.all.filter((f) => f.status === 'unverified').map((f) => mfa.unenroll({ factorId: f.id })));
      const { data: enrolled, error: enrollError } = await mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
      if (cancelled) return;
      if (enrollError || !enrolled) return setState({ kind: 'error', message: 'Could not start authenticator setup. Refresh to try again.' });
      setState({ kind: 'enroll', factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
    return () => { cancelled = true; };
  }, [next, router]);

  const submit = form.handleSubmit(async ({ code }) => {
    if (state.kind !== 'challenge' && state.kind !== 'enroll') return;
    setError('');
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
    if (verifyError) {
      setError('That code did not match. Check your device time is correct and try the latest code.');
      form.reset();
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    router.replace(next);
    router.refresh();
  });

  if (state.kind === 'loading') return <Skeleton className="h-56 w-full" />;
  if (state.kind === 'error') {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-5">
      {state.kind === 'enroll' && (
        <div className="grid gap-3">
          <ol className="m-0 grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
            <li>Install Google Authenticator, Microsoft Authenticator or 1Password.</li>
            <li>Scan this QR code, or enter the key manually.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <div className="flex justify-center rounded-lg border bg-white p-4">
            {/* Supabase returns the QR code as an SVG data URI. */}
            <img src={state.qrCode} alt="Authenticator QR code" className="size-44" />
          </div>
          <div className="rounded-md bg-muted px-3 py-2 text-center">
            <span className="block text-xs text-muted-foreground">Setup key</span>
            <code className="break-all font-mono text-sm">{state.secret}</code>
          </div>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="m-0 grid gap-4">
        <FormField id="mfa-code" label="Authentication code" error={errors.code?.message}>
          <Input
            id="mfa-code"
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
          {isSubmitting ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {state.kind === 'enroll' ? 'Activate and continue' : 'Verify'}
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}
