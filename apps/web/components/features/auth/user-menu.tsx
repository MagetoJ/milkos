'use client';

import Link from 'next/link';
import { LogOut, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from '@/lib/auth/types';
import { useAuth } from './auth-provider';

export function UserMenu() {
  const { status, me, signOut } = useAuth();

  if (status === 'anonymous') {
    return (
      <Button asChild size="sm" variant="secondary">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }
  if (!me) return <div className="size-9 animate-pulse rounded-full bg-white/10" />;

  const initials = me.user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white hover:bg-white/25"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid gap-1">
          <span className="truncate text-sm font-medium text-foreground">{me.user.displayName}</span>
          <span className="truncate">{me.user.email || me.user.phone}</span>
          {me.user.platformRole && <Badge variant="secondary" className="mt-1">{ROLE_LABELS[me.user.platformRole]}</Badge>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account"><UserRound /> Account & security</Link>
        </DropdownMenuItem>
        {me.session.aal === 'aal2' && (
          <DropdownMenuItem disabled><ShieldCheck /> Verified with authenticator</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut('local')}><LogOut /> Sign out</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut('global')}><MonitorSmartphone /> Sign out of all devices</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
