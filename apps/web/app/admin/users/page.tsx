'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Search, UserPlus } from 'lucide-react';
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
import { ROLE_LABELS, type PlatformRole } from '@/lib/auth/types';

interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  platformRole: PlatformRole | null;
  status: 'ACTIVE' | 'SUSPENDED';
  lastSignInAt: string | null;
  memberships: Array<{ role: string; cooperative: { id: string; name: string } }>;
}

const PLATFORM_ROLES: PlatformRole[] = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT'];
const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50';

export default function AdminUsersPage() {
  return (
    <RequirePermission permission="platform:users:read">
      <AdminUsers />
    </RequirePermission>
  );
}

function AdminUsers() {
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const canManage = can('platform:users:manage');

  const users = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => apiFetch<AdminUser[]>(`/admin/users?take=100${q ? `&q=${encodeURIComponent(q)}` : ''}`, { cooperativeId: null }),
  });

  const update = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: 'platform-role' | 'status'; body: object }) =>
      apiFetch(`/admin/users/${id}/${path}`, { method: 'PATCH', body: JSON.stringify(body), cooperativeId: null }),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Platform control</span>
        <h1 className="m-0 text-2xl font-semibold">Users & platform roles</h1>
        <p className="m-0 text-sm text-muted-foreground">Platform roles grant cross-cooperative access. Only Super Admins can change them; every change is audited.</p>
      </div>

      {canManage && <InviteCard />}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>All users</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search name, email or phone" className="h-9 pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {users.isPending ? (
            <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : users.isError ? (
            <Alert variant="destructive"><AlertDescription>Could not load users: {users.error.message}</AlertDescription></Alert>
          ) : users.data.length === 0 ? (
            <p className="m-0 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {q ? 'No users match this search. Try part of an email address.' : 'No users yet. People appear here after their first sign-in or when invited.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="m-0 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-2 font-medium">User</th>
                    <th className="p-2 font-medium">Cooperatives</th>
                    <th className="p-2 font-medium">Platform role</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((u) => {
                    const self = u.id === me?.user.id;
                    const busy = update.isPending && update.variables?.id === u.id;
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="p-2">
                          <div className="font-medium">{u.displayName}{self && <span className="text-muted-foreground"> (you)</span>}</div>
                          <div className="text-xs text-muted-foreground">{u.email || u.phone}</div>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {u.memberships.length ? u.memberships.map((m) => `${m.cooperative.name} (${ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] || m.role})`).join(', ') : '—'}
                        </td>
                        <td className="p-2">
                          <select
                            aria-label={`Platform role for ${u.displayName}`}
                            className={selectClass}
                            value={u.platformRole || ''}
                            disabled={!canManage || self || busy}
                            onChange={(e) => update.mutate({ id: u.id, path: 'platform-role', body: { platformRole: e.target.value || null } })}
                          >
                            <option value="">None</option>
                            {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'}>{u.status.toLowerCase()}</Badge>
                            {canManage && !self && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => update.mutate({ id: u.id, path: 'status', body: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })}
                              >
                                {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                              </Button>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'Never'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
  platformRole: z.enum(['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT']),
});

function InviteCard() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', displayName: '', platformRole: 'PLATFORM_ADMIN' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      const res = await apiFetch<{ invited: boolean }>('/admin/users/invite', {
        method: 'POST', body: JSON.stringify({ ...values, displayName: values.displayName || undefined }), cooperativeId: null,
      });
      setResult({ ok: true, text: res.invited ? `Invitation sent to ${values.email}.` : `${values.email} already had an account and now has the role.` });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite platform staff</CardTitle>
        <CardDescription>They receive an email to set a password, then must enrol an authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="m-0 grid items-end gap-3 md:grid-cols-[1fr_1fr_12rem_auto]">
          <FormField id="invite-email" label="Email" error={errors.email?.message}>
            <Input id="invite-email" type="email" {...form.register('email')} />
          </FormField>
          <FormField id="invite-name" label="Name (optional)">
            <Input id="invite-name" {...form.register('displayName')} />
          </FormField>
          <FormField id="invite-role" label="Role">
            <select id="invite-role" className={`${selectClass} h-11`} {...form.register('platformRole')}>
              {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
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
