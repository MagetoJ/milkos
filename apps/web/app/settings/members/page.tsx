'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, UserPlus, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FormField } from '@/components/features/auth/form-field';
import { RequirePermission } from '@/components/features/auth/require-permission';
import { useAuth } from '@/components/features/auth/auth-provider';
import { apiFetch } from '@/lib/api/client';
import { ROLE_LABELS, type MembershipRole, type MembershipStatus } from '@/lib/auth/types';

interface Member {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
  user: { id: string; displayName: string; email: string | null; phone: string | null; lastSignInAt: string | null };
}

const MEMBER_ROLES: MembershipRole[] = ['COOPERATIVE_MANAGER', 'ACCOUNTANT', 'COLLECTOR', 'FARMER'];
const STATUS_VARIANT = { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'destructive', REVOKED: 'outline' } as const;

export default function MembersPage() {
  return (
    <RequirePermission permission="members:read">
      <Members />
    </RequirePermission>
  );
}

function Members() {
  const { me, activeCooperativeId, activeCooperative, can } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const canManage = can('members:manage');
  const queryKey = ['members', activeCooperativeId];

  const members = useQuery({
    queryKey,
    queryFn: () => apiFetch<Member[]>(`/cooperatives/${activeCooperativeId}/members`),
    enabled: Boolean(activeCooperativeId),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' }) =>
      apiFetch(`/cooperatives/${activeCooperativeId}/members/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey }); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">{activeCooperative?.name || 'Cooperative'}</span>
        <h1 className="m-0 text-2xl font-semibold">Members & roles</h1>
        <p className="m-0 text-sm text-muted-foreground">Managers and accountants must use an authenticator app. Removing someone takes effect on their next request.</p>
      </div>

      {canManage && activeCooperativeId && <InviteMemberCard cooperativeId={activeCooperativeId} onInvited={() => queryClient.invalidateQueries({ queryKey })} />}

      <Card>
        <CardHeader><CardTitle>People with access</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {members.isPending ? (
            <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : members.isError ? (
            <Alert variant="destructive"><AlertDescription>Could not load members: {members.error.message}</AlertDescription></Alert>
          ) : members.data.length === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <Users className="size-8 text-muted-foreground" />
              <p className="m-0 text-sm text-muted-foreground">No members yet. Invite collectors and staff by email above so they can sign in.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {members.data.map((m) => {
                const self = m.user.id === me?.user.id;
                const busy = setStatus.isPending && setStatus.variables?.id === m.id;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{m.user.displayName}{self && <span className="text-muted-foreground"> (you)</span>}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.user.email || m.user.phone}</span>
                    </div>
                    <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>
                    <Badge variant={STATUS_VARIANT[m.status]}>{m.status.toLowerCase()}</Badge>
                    {canManage && !self && m.status !== 'REVOKED' && (
                      <div className="flex gap-1">
                        {m.status === 'SUSPENDED' ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: m.id, status: 'ACTIVE' })}>Reactivate</Button>
                        ) : m.status === 'ACTIVE' ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: m.id, status: 'SUSPENDED' })}>Suspend</Button>
                        ) : null}
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setStatus.mutate({ id: m.id, status: 'REVOKED' })}>Remove</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  displayName: z.string().trim().max(120).optional(),
  role: z.enum(['COOPERATIVE_MANAGER', 'ACCOUNTANT', 'COLLECTOR', 'FARMER']),
});

function InviteMemberCard({ cooperativeId, onInvited }: { cooperativeId: string; onInvited: () => void }) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', displayName: '', role: 'COLLECTOR' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      const res = await apiFetch<{ emailSent: boolean }>(`/cooperatives/${cooperativeId}/members`, {
        method: 'POST', body: JSON.stringify({ ...values, displayName: values.displayName || undefined }),
      });
      setResult({ ok: true, text: res.emailSent ? `Invitation emailed to ${values.email}.` : `${values.email} already has an account and can now access this cooperative.` });
      form.reset({ email: '', displayName: '', role: values.role });
      onInvited();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a member</CardTitle>
        <CardDescription>They’ll get an email to set a password. Collectors can then sign in on their phones.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="m-0 grid items-end gap-3 md:grid-cols-[1fr_1fr_11rem_auto]">
          <FormField id="member-email" label="Email" error={errors.email?.message}>
            <Input id="member-email" type="email" {...form.register('email')} />
          </FormField>
          <FormField id="member-name" label="Name (optional)">
            <Input id="member-name" {...form.register('displayName')} />
          </FormField>
          <FormField id="member-role" label="Role">
            <select id="member-role" className="h-11 rounded-md border border-input bg-background px-2 text-sm" {...form.register('role')}>
              {MEMBER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </FormField>
          <Button type="submit" className="h-11" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <UserPlus />} Invite
          </Button>
        </form>
        {result && <p className={`m-0 mt-3 text-sm ${result.ok ? 'text-success' : 'text-destructive'}`}>{result.text}</p>}
      </CardContent>
    </Card>
  );
}
