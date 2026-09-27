'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Milk } from 'lucide-react';
import { CooperativeSwitcher } from '@/components/features/auth/cooperative-switcher';
import { UserMenu } from '@/components/features/auth/user-menu';
import { useAuth } from '@/components/features/auth/auth-provider';
import { AUTH_FLOW_PATHS } from '@/lib/auth/redirect';
import type { Permission } from '@/lib/auth/types';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  /** Omit for links every visitor may see. */
  permission?: Permission;
  signedInOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Register Cooperative', href: '/cooperatives/register', signedInOnly: true },
  { label: 'Track Application', href: '/applications/status' },
  { label: 'Co-op Dashboard', href: '/dashboard', permission: 'cooperative:read' },
  { label: 'New Collection', href: '/collections/new', permission: 'collections:create' },
  { label: 'Coolers', href: '/coolers', permission: 'coolers:read' },
  { label: 'Pricing', href: '/pricing', permission: 'pricing:read' },
  { label: 'SMS', href: '/sms', permission: 'sms:read' },
  { label: 'Corrections', href: '/corrections', permission: 'corrections:decide' },
  { label: 'Reversals', href: '/reversals', permission: 'reversals:decide' },
  { label: 'Reports', href: '/reports', permission: 'reports:read' },
  { label: 'Members', href: '/settings/members', permission: 'members:read' },
  { label: 'Applications', href: '/admin/applications', permission: 'platform:cooperatives:read' },
  { label: 'Payments', href: '/admin/payments', permission: 'platform:payments:verify' },
  { label: 'Users', href: '/admin/users', permission: 'platform:users:read' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { status, can } = useAuth();

  if (AUTH_FLOW_PATHS.includes(pathname)) return null;

  const visible = navItems.filter((item) =>
    item.permission ? can(item.permission) : !item.signedInOnly || status === 'authenticated');

  return (
    <div className="sticky top-0 z-40 border-b border-white/10 bg-[#1e293b] text-white">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-white">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary"><Milk className="size-4" /></span>
          <span className="hidden sm:inline">MaziwaCollect</span>
        </Link>
        {status === 'authenticated' && <CooperativeSwitcher />}
        <div className="ml-auto"><UserMenu /></div>
      </div>
      <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pb-2" aria-label="Main">
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white',
              pathname === item.href && 'bg-sky-600 text-white hover:bg-sky-600',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
