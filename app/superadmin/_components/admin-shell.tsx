'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Milk,
  RefreshCw,
  ScrollText,
  Settings,
  Snowflake,
  Truck,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { signOutEverywhere } from '@/lib/offline/auth';
import { useSuperadminData } from './superadmin-data';
import { GlobalSearch } from './global-search';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

async function signOut() {
  try {
    await signOutEverywhere(); // also ends this device's offline session and removes cached data
  } finally {
    window.location.assign('/login');
  }
}

export function AdminShell({ email, children }: { email?: string; children: ReactNode }) {
  const pathname = usePathname();
  const { counts } = useSuperadminData();
  const [open, setOpen] = useState(false);

  const groups: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: '/superadmin', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/superadmin/onboarding', label: 'Onboarding', icon: ClipboardCheck, count: counts.applications },
      ],
    },
    {
      label: 'Network',
      items: [
        { href: '/superadmin/cooperatives', label: 'Cooperatives', icon: Building2 },
        { href: '/superadmin/farmers', label: 'Farmers', icon: Users },
        { href: '/superadmin/collectors', label: 'Collectors', icon: Truck },
        { href: '/superadmin/coolers', label: 'Coolers', icon: Snowflake },
        { href: '/superadmin/collections', label: 'Milk collections', icon: Milk },
        { href: '/superadmin/sync', label: 'Sync & devices', icon: RefreshCw },
      ],
    },
    {
      label: 'Platform',
      items: [
        { href: '/superadmin/users', label: 'Users', icon: UserCog },
        { href: '/superadmin/payments', label: 'Payments & SMS', icon: CreditCard, count: counts.payments },
        { href: '/superadmin/reports', label: 'Reports', icon: BarChart3 },
        { href: '/superadmin/audit', label: 'Audit log', icon: ScrollText },
        { href: '/superadmin/settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const isActive = (href: string) => (href === '/superadmin' ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="Superadmin" className="flex h-full flex-col bg-[#0F3325] text-[#DCE8E0]">
      <div className="px-5 pb-5 pt-6">
        <p className="text-lg font-semibold tracking-tight text-white">Milkflow</p>
        <p className="text-xs text-[#9DB8A8]">Platform administration</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#7FA08D]">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon, count }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#E8B04B] ${
                        active ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#E8B04B]" />}
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {!!count && (
                        <span className="rounded-full bg-[#E8B04B] px-1.5 text-[11px] font-semibold tabular-nums leading-5 text-[#3A2A06]">
                          {count}
                          <span className="sr-only"> waiting</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        {email && <p className="truncate text-xs text-[#9DB8A8]" title={email}>{email}</p>}
        <button
          onClick={signOut}
          className="mt-2 flex items-center gap-2 text-sm text-white/90 outline-none hover:text-white focus-visible:underline"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#17221D]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-30 border-b border-[#DDE3DE] bg-white/95 backdrop-blur lg:pl-60">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-8">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 hover:bg-[#EEF1EC] lg:hidden">
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-5 z-10 rounded-md p-1 text-white/80 hover:text-white"
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
