'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Permission } from '@/lib/auth/types';
import { useAuth } from './auth-provider';

interface RequirePermissionProps {
  permission: Permission;
  children: ReactNode;
}

/**
 * Hides UI the user may not use. This is presentation only: the API enforces
 * the same permission on every request.
 */
export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { meLoading, can, activeCooperativeId } = useAuth();

  if (meLoading) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (can(permission)) return <>{children}</>;

  const needsCooperative = !permission.startsWith('platform:') && !activeCooperativeId;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="m-0 text-xl font-semibold">{needsCooperative ? 'Select a cooperative first' : 'You don’t have access to this page'}</h1>
      <p className="m-0 text-sm text-muted-foreground">
        {needsCooperative
          ? 'This page shows cooperative data. Choose which cooperative you are working in to continue.'
          : 'Your role does not include this area. Ask a cooperative manager or platform administrator if you need access.'}
      </p>
      <Button asChild variant="outline">
        <Link href={needsCooperative ? '/select-cooperative' : '/dashboard'}>{needsCooperative ? 'Choose cooperative' : 'Back to dashboard'}</Link>
      </Button>
    </div>
  );
}
