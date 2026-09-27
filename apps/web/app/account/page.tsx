'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Factor } from '@supabase/supabase-js';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/features/auth/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { ROLE_LABELS } from '@/lib/auth/types';

export default function AccountPage() {
  const { me, meLoading, signOut } = useAuth();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [message, setMessage] = useState('');

  const loadFactors = () => createClient().auth.mfa.listFactors().then(({ data }) => setFactors(data?.totp || []));
  useEffect(() => { loadFactors(); }, []);

  async function removeFactor(factorId: string) {
    if (me?.session.mfaRequired) {
      setMessage('Your role requires two-step verification, so the authenticator cannot be removed. Set up a new one first, or ask a Super Admin.');
      return;
    }
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setMessage(error ? 'Removing the authenticator requires a recent verification. Sign in again and retry.' : 'Authenticator removed.');
    loadFactors();
  }

  if (meLoading || !me) {
    return <div className="mx-auto grid max-w-2xl gap-4 px-4 py-10"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-4 py-10">
      <h1 className="m-0 text-2xl font-semibold">Account & security</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your sign-in identity. Roles are granted by cooperative managers and platform administrators.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <Row label="Name" value={me.user.displayName} />
          <Row label="Email" value={me.user.email || '—'} />
          <Row label="Phone" value={me.user.phone || '—'} />
          <Row label="Platform role" value={me.user.platformRole ? ROLE_LABELS[me.user.platformRole] : 'None'} />
          <div className="grid gap-1">
            <span className="text-muted-foreground">Cooperative roles</span>
            {me.cooperatives.length === 0 ? <span>None yet</span> : me.cooperatives.map((c) => (
              <span key={c.id}>{c.name}: {c.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Two-step verification
            {me.session.mfaRequired && <Badge variant="secondary">Required for your role</Badge>}
          </CardTitle>
          <CardDescription>An authenticator app code is asked for after your password or email code.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {factors === null ? <Skeleton className="h-12" /> : factors.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4">
              <span className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldOff className="size-4" /> No authenticator set up.</span>
              <Button asChild><Link href="/auth/mfa?next=/account">Set up authenticator</Link></Button>
            </div>
          ) : factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border p-4">
              <span className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4 text-success" />
                {f.friendly_name || 'Authenticator app'}
                <span className="text-muted-foreground">· added {new Date(f.created_at).toLocaleDateString()}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => removeFactor(f.id)}>Remove</Button>
            </div>
          ))}
          {message && <p className="m-0 text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Lost a phone or used a shared computer? Sign out everywhere.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/forgot-password"><KeyRound /> Change password</Link></Button>
          <Button variant="destructive" onClick={() => signOut('global')}>Sign out of all devices</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
