'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, MapPin, Menu, Milk, Snowflake, UserCog, Users, X, type LucideIcon } from 'lucide-react';
import { TOKEN_KEY } from '@/lib/auth';
import { useCoop } from './coop-context';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export async function signOut() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } finally {
    localStorage.removeItem(TOKEN_KEY);
    window.location.assign('/login');
  }
}

export function CoopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { overview, email } = useCoop();
  const [open, setOpen] = useState(false);

  // Close the mobile menu after navigating.
  useEffect(() => setOpen(false), [pathname]);

  const nav: NavItem[] = [
    { href: '/cooperatives', label: 'Overview', icon: LayoutDashboard },
    { href: '/cooperatives/centres', label: 'Collection centres', icon: MapPin, count: overview.centres.active },
    { href: '/cooperatives/farmers', label: 'Farmers', icon: Users, count: overview.farmers.active },
    { href: '/cooperatives/team', label: 'Team', icon: UserCog },
    { href: '/cooperatives/operations', label: 'Field operations', icon: Snowflake, count: overview.coolers.operational },
    { href: '/collections', label: 'Milk collections', icon: Milk },
  ];

  const isActive = (href: string) => (href === '/cooperatives' ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="Cooperative" className="flex h-full flex-col bg-[#0F3325] text-[#DCE8E0]">
      <div className="px-5 pb-6 pt-6">
        <p className="text-lg font-semibold tracking-tight text-white">Milkflow</p>
        <p className="mt-1 truncate text-sm font-medium text-[#DCE8E0]" title={overview.cooperative.name}>
          {overview.cooperative.name}
        </p>
        <p className="text-xs text-[#9DB8A8]">
          {overview.cooperative.code} · {overview.role === 'COOP_ADMIN' ? 'Administrator' : 'Manager'}
        </p>
      </div>

      <ul className="flex-1 space-y-0.5 px-3">
        {nav.map(({ href, label, icon: Icon, count }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#E8B04B] ${
                  active ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'
                }`}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#E8B04B]" />}
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {count !== undefined && <span className="text-xs tabular-nums text-[#9DB8A8]">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-white/10 px-5 py-4">
        {email && (
          <p className="truncate text-xs text-[#9DB8A8]" title={email}>
            {email}
          </p>
        )}
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

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#DDE3DE] bg-white px-4 py-3 lg:hidden">
        <span className="truncate font-semibold">{overview.cooperative.name}</span>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 hover:bg-[#EEF1EC]">
          <Menu className="size-5" />
        </button>
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
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
      </main>
    </div>
  );
}