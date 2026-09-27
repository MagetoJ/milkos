'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/features/auth/auth-provider';
import { apiFetch } from '@/lib/api/client';
import { safeNext } from '@/lib/auth/redirect';
import { ROLE_LABELS } from '@/lib/auth/types';

interface CooperativeSummary { id: string; name: string; status: string }

export default function SelectCooperativePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-10"><Skeleton className="h-40 w-full" /></div>}>
      <SelectCooperative />
    </Suspense>
  );
}

function SelectCooperative() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { me, meLoading, activeCooperativeId, setActiveCooperative, can } = useAuth();
  const [query, setQuery] = useState('');

  const isPlatformStaff = can('platform:cooperatives:read');
  const allCooperatives = useQuery({
    queryKey: ['admin', 'cooperatives'],
    queryFn: () => apiFetch<CooperativeSummary[]>('/admin/cooperatives', { cooperativeId: null }),
    enabled: isPlatformStaff,
  });
  const filtered = useMemo(
    () => (allCooperatives.data || []).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [allCooperatives.data, query],
  );

  const choose = (id: string) => {
    setActiveCooperative(id);
    router.push(next);
  };

  if (meLoading || !me) {
    return (
      <div className="mx-auto grid max-w-xl gap-3 px-4 py-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-10">
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl font-semibold">Choose a cooperative</h1>
        <p className="m-0 text-sm text-muted-foreground">Everything you see and record applies to the cooperative you pick here. You can switch any time from the top bar.</p>
      </div>

      {me.cooperatives.length > 0 ? (
        <div className="grid gap-2">
          {me.cooperatives.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c.id)}
              className="flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 text-left transition-colors hover:bg-accent"
            >
              <Building2 className="size-5 text-muted-foreground" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{c.name}</span>
                <span className="truncate text-xs text-muted-foreground">{c.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
              </span>
              {c.id === activeCooperativeId && <Badge variant="success">Active</Badge>}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : !isPlatformStaff ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <Users className="size-10 text-muted-foreground" />
          <h2 className="m-0 text-lg font-semibold">You’re not part of a cooperative yet</h2>
          <p className="m-0 text-sm text-muted-foreground">
            Register your cooperative for approval, or ask your cooperative manager to invite{' '}
            <span className="font-medium text-foreground">{me.user.email || me.user.phone}</span>.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="lg"><Link href="/cooperatives/register">Register a cooperative</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/applications/status">Track an application</Link></Button>
          </div>
        </div>
      ) : null}

      {isPlatformStaff && (
        <div className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">All cooperatives <span className="font-normal text-muted-foreground">(platform access)</span></h2>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" className="pl-9" />
          </div>
          {allCooperatives.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : filtered.length === 0 ? (
            <p className="m-0 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {query ? 'No cooperative matches that name. Check the spelling or clear the search.' : 'No cooperatives have registered yet. Approved applications will appear here.'}
            </p>
          ) : (
            <div className="grid max-h-96 gap-1 overflow-y-auto rounded-lg border bg-card p-1">
              {filtered.map((c) => (
                <button key={c.id} type="button" onClick={() => choose(c.id)} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 text-left hover:bg-accent">
                  <span className="flex-1 truncate text-sm">{c.name}</span>
                  <Badge variant={c.status === 'APPROVED' ? 'success' : 'warning'}>{c.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
