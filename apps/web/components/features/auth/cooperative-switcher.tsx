'use client';

import Link from 'next/link';
import { Building2, Check, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLE_LABELS } from '@/lib/auth/types';
import { useAuth } from './auth-provider';

/** Always-visible tenant context: which cooperative every screen is operating on. */
export function CooperativeSwitcher() {
  const { me, meLoading, activeCooperative, activeCooperativeId, setActiveCooperative } = useAuth();

  if (meLoading) return <Skeleton className="h-10 w-44 bg-white/10" />;
  if (!me) return null;

  const isPlatformStaff = me.user.platformRole !== null;
  if (!me.cooperatives.length && !isPlatformStaff) {
    return (
      <Button asChild variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
        <Link href="/select-cooperative">No cooperative yet</Link>
      </Button>
    );
  }

  const label = activeCooperative?.name || (activeCooperativeId ? 'Cooperative (platform access)' : 'Select cooperative');
  const roleLabel = activeCooperative?.roles.map((r) => ROLE_LABELS[r]).join(', ')
    || (activeCooperativeId && isPlatformStaff ? ROLE_LABELS[me.user.platformRole!] : null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 min-w-0 max-w-[16rem] cursor-pointer items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 text-left text-white hover:bg-white/10"
          aria-label="Switch cooperative"
        >
          <Building2 className="size-4 shrink-0 text-white/70" />
          <span className="grid min-w-0 leading-tight">
            <span className="truncate text-sm font-medium">{label}</span>
            {roleLabel && <span className="truncate text-[11px] text-white/60">{roleLabel}</span>}
          </span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Your cooperatives</DropdownMenuLabel>
        {me.cooperatives.length === 0 && <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">You are not a member of any cooperative.</p>}
        {me.cooperatives.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => setActiveCooperative(c.id)}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate">{c.name}</span>
              <span className="truncate text-xs text-muted-foreground">{c.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
            </span>
            {c.id === activeCooperativeId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {isPlatformStaff && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/select-cooperative"><Search /> Open any cooperative…</Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
