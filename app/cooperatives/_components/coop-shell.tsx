'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Banknote, Bell, ChevronsLeft, ChevronsRight, ClipboardCheck, Settings, FileBarChart, Gauge, LayoutDashboard, LogOut, MapPin, Menu, MessageSquareText, Milk, RefreshCw,
  Search, Smartphone, Snowflake, Tags, UserCog, Users, X, type LucideIcon,
} from 'lucide-react';
import { ConnectionStatus, OfflineBanner, SyncStatus } from '@/components/offline/status';
import { useSidebarCollapsed } from '@/lib/hooks/use-sidebar';
import { signOutEverywhere } from '@/lib/offline/auth';
import { syncEngine } from '@/lib/sync/engine';
import { inboxCount } from '../_api/finance-client';
import { CommandPalette, useCommandShortcut } from './command-palette';
import { useCoop } from './coop-context';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  /** Visually separates groups of the menu. */
  group?: string;
}

/** Unread notification count, refreshed every minute while online. */
function useUnread(online: boolean) {
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (!online) return;
    inboxCount().then((r) => setCount(r.unread), () => undefined);
  }, [online]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);
  return { count, reload: load };
}

/**
 * Sign out. Unsynchronised changes are never thrown away: they stay on this device and sync after the
 * same person signs in again; the user is told so first.
 */
export async function signOut() {
  const { pending, syncing, failed, conflict } = syncEngine.getState().counts;
  const waiting = pending + syncing + failed + conflict;
  if (
    waiting > 0 &&
    !window.confirm(
      `You have ${waiting} unsynchronized record${waiting === 1 ? '' : 's'}. They stay on this device and sync after you sign in again. Sign out?`,
    )
  ) {
    return;
  }
  try {
    syncEngine.stop();
    await signOutEverywhere();
  } finally {
    window.location.assign('/login');
  }
}

export function CoopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { overview, email, offlineCapable, isOnline } = useCoop();
  // The mobile menu belongs to the page it was opened on, so navigating closes it.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const open = menuFor === pathname;
  const setOpen = (value: boolean) => setMenuFor(value ? pathname : null);
  const [searching, setSearching] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed('cooperative');
  const unread = useUnread(isOnline);
  const openSearch = useCallback(() => setSearching(true), []);
  useCommandShortcut(openSearch);

  // Re-check notifications after navigating.
  const reloadUnread = unread.reload;
  useEffect(() => {
    reloadUnread();
  }, [pathname, reloadUnread]);

  const k = overview.kpis;
  const nav: NavItem[] = [
    { href: '/cooperatives', label: 'Overview', icon: LayoutDashboard },
    { href: '/cooperatives/notifications', label: 'Notifications', icon: Bell, count: unread.count || undefined },
    { href: '/collections', label: 'Milk collections', icon: Milk, group: 'Collections' },
    { href: '/cooperatives/corrections', label: 'Corrections', icon: ClipboardCheck, count: k?.pending_corrections || undefined },
    { href: '/collector', label: 'Collector app', icon: Smartphone },
    { href: '/cooperatives/farmers', label: 'Farmers', icon: Users, count: overview.farmers.active, group: 'People & places' },
    { href: '/cooperatives/centres', label: 'Collection centres', icon: MapPin, count: overview.centres.active },
    { href: '/cooperatives/team', label: 'Team', icon: UserCog },
    { href: '/cooperatives/operations', label: 'Field operations', icon: Snowflake, count: overview.coolers.operational },
    { href: '/cooperatives/coolers', label: 'Cooler monitoring', icon: Gauge },
    { href: '/cooperatives/payments', label: 'Farmer payments', icon: Banknote, count: k?.pending_payments || undefined, group: 'Finance' },
    { href: '/cooperatives/pricing', label: 'Milk pricing', icon: Tags },
    { href: '/cooperatives/sms-credits', label: 'SMS credits', icon: MessageSquareText },
    { href: '/cooperatives/reports', label: 'Reports', icon: FileBarChart },
    ...(offlineCapable ? [{ href: '/cooperatives/sync', label: 'Sync center', icon: RefreshCw, group: 'Device' }] : []),
    { href: '/cooperatives/settings', label: overview.role === 'COOP_ADMIN' ? 'Settings' : 'My settings', icon: Settings, group: offlineCapable ? undefined : 'Account' },
  ];

  const isActive = (href: string) => (href === '/cooperatives' ? pathname === href : pathname.startsWith(href));

  const sidebar = (narrow: boolean) => (
    <nav aria-label="Cooperative" className="flex h-full flex-col overflow-y-auto bg-[#0F3325] text-[#DCE8E0]">
      <div className={`pb-6 pt-6 ${narrow ? 'px-2 text-center' : 'px-5'}`}>
        <p className="text-lg font-semibold tracking-tight text-white">{narrow ? 'MO' : 'MilkOS'}</p>
        {!narrow && (
          <>
            <p className="mt-1 truncate text-sm font-medium text-[#DCE8E0]" title={overview.cooperative.name}>
              {overview.cooperative.name}
            </p>
            <p className="text-xs text-[#9DB8A8]">
              {overview.cooperative.code} · {overview.role === 'COOP_ADMIN' ? 'Administrator' : 'Manager'}
            </p>
          </>
        )}
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={openSearch}
          aria-label={narrow ? 'Search (Ctrl K)' : undefined}
          className="flex w-full items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm text-[#DCE8E0] outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-[#E8B04B]"
        >
          <Search aria-hidden className="size-4" />
          {!narrow && <span className="flex-1 text-left">Search</span>}
          {!narrow && <kbd className="rounded border border-white/20 px-1.5 text-[10px] text-[#9DB8A8]">Ctrl K</kbd>}
        </button>
      </div>

      <ul className="flex-1 space-y-0.5 px-3">
        {nav.map(({ href, label, icon: Icon, count, group }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              {group && !narrow && <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[#9DB8A8]">{group}</p>}
              {group && narrow && <hr aria-hidden className="mx-2 my-2 border-white/10" />}
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                title={narrow ? label : undefined}
                aria-label={narrow ? (count !== undefined ? `${label} (${count})` : label) : undefined}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#E8B04B] ${
                  active ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'
                }`}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#E8B04B]" />}
                <Icon aria-hidden className="size-4 shrink-0" />
                {!narrow && <span className="flex-1">{label}</span>}
                {count !== undefined && !narrow && <span className="text-xs tabular-nums text-[#9DB8A8]">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      {!narrow && (
        <div className="space-y-3 border-t border-white/10 px-5 py-4">
          <ConnectionStatus dark />
          {offlineCapable && <SyncStatus dark />}
        </div>
      )}

      <div className={`border-t border-white/10 py-4 ${narrow ? 'px-3' : 'px-5'}`}>
        {email && !narrow && (
          <p className="truncate text-xs text-[#9DB8A8]" title={email}>
            {email}
          </p>
        )}
        <button
          onClick={signOut}
          aria-label={narrow ? 'Sign out' : undefined}
          className="mt-2 flex items-center gap-2 text-sm text-white/90 outline-none hover:text-white focus-visible:underline"
        >
          <LogOut aria-hidden className="size-4" /> {!narrow && 'Sign out'}
        </button>
      </div>
    </nav>
  );
  const pad = collapsed ? 'lg:pl-16' : 'lg:pl-60';

  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#17221D]">
      <aside className={`fixed inset-y-0 left-0 hidden lg:block ${collapsed ? 'w-16' : 'w-60'}`}>{sidebar(collapsed)}</aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-[#DDE3DE] bg-white px-4 py-2 lg:hidden">
        <span className="truncate font-semibold">{overview.cooperative.name}</span>
        <span className="flex items-center gap-1">
          <button onClick={openSearch} aria-label="Search" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-[#EEF1EC]">
            <Search className="size-5" />
          </button>
          <Link href="/cooperatives/notifications" aria-label={`Notifications${unread.count ? `, ${unread.count} unread` : ''}`} className="relative inline-flex size-10 items-center justify-center rounded-md hover:bg-[#EEF1EC]">
            <Bell className="size-5" />
            {unread.count > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[#B42318] px-1 text-center text-[10px] font-bold leading-4 text-white">{unread.count > 99 ? '99+' : unread.count}</span>}
          </Link>
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-[#EEF1EC]">
            <Menu className="size-5" />
          </button>
        </span>
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
            {sidebar(false)}
          </div>
        </div>
      )}

      <main className={pad}>
        <div className="hidden items-center justify-end gap-3 border-b border-mo-line bg-white px-8 py-2 lg:flex">
          <button
            onClick={toggleCollapsed} aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'} aria-pressed={collapsed}
            className="mr-auto inline-flex size-9 items-center justify-center rounded-md text-mo-muted hover:bg-mo-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mo-brand/40"
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-5" /> : <ChevronsLeft aria-hidden className="size-5" />}
          </button>
          {offlineCapable && collapsed && <SyncStatus compact />}
          <CoolerContext />
          <Link href="/cooperatives/notifications" aria-label={`Notifications${unread.count ? `, ${unread.count} unread` : ''}`} className="relative inline-flex size-9 items-center justify-center rounded-md text-[#3C4A43] hover:bg-[#EEF1EC]">
            <Bell className="size-5" />
            {unread.count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#B42318] px-1 text-center text-[10px] font-bold leading-4 text-white">{unread.count > 99 ? '99+' : unread.count}</span>}
          </Link>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
          {offlineCapable && <OfflineBanner />}
          {children}
        </div>
      </main>
      <CommandPalette open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}

/** Cooler context for the top bar: how many are online and recent alerts (from the overview). */
function CoolerContext() {
  const { overview } = useCoop();
  const k = overview.kpis;
  if (!k) return null;
  const alerts = k.cooler_alerts_24h;
  return (
    <Link href="/cooperatives/coolers" className="inline-flex items-center gap-2 rounded-full border border-[#DDE3DE] px-3 py-1 text-xs text-[#3C4A43] hover:bg-[#F6F7F4]">
      <Snowflake aria-hidden className="size-3.5" />
      <span>{k.coolers_online} of {k.active_coolers} coolers online</span>
      <span aria-hidden>·</span>
      <span className={alerts ? 'font-semibold text-[#B42318]' : ''}>{alerts ? `${alerts} alert${alerts === 1 ? '' : 's'} (24 h)` : 'No alerts'}</span>
    </Link>
  );
}
