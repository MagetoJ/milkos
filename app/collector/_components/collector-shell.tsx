'use client';

// The collector's mobile app frame: a compact header with connectivity and sync state, the screen, and a
// bottom navigation (Home, Collections, Farmers, Sync, More) sized for thumbs, and a "+ New Collection" button on
// every screen so a collection is always one tap away (spec sections 16 and 34). Purpose-built for phones; on a wide
// screen it simply stays phone-width in the middle.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, CloudOff, Ellipsis, History, Home, Plus, RefreshCw, Users, type LucideIcon } from 'lucide-react';
import { inboxCount } from '@/app/cooperatives/_api/finance-client';
import { CoolerSwitcher, coolerStatus, type ContextCooler } from '@/components/shell/context-switchers';
import { coolerOptions } from '@/lib/collections/batch-client';
import { useWorkingCooler } from '@/lib/hooks/use-working-cooler';
import { useConnectivity, useIsOnline, useLocalQuery, useSyncState } from '@/lib/sync/hooks';

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/collector', label: 'Home', icon: Home },
  { href: '/collector/collections', label: 'Collections', icon: History },
  { href: '/collector/farmers', label: 'Farmers', icon: Users },
  { href: '/collector/sync', label: 'Sync', icon: RefreshCw },
  { href: '/collector/more', label: 'More', icon: Ellipsis },
];

/** Screens that already have the dominant New Collection action (Home) or are the collection itself (the wizard). */
export const hasOwnNewCollection = (pathname: string) => pathname === '/collector' || pathname.startsWith('/collector/new');

const TONES = {
  blue: 'bg-[#E6EEF8] text-[#1F4E86]',
  red: 'bg-[#FDECEA] text-[#B42318]',
  amber: 'bg-[#FBF1DC] text-[#8A5A0B]',
  green: 'bg-[#E3F1E9] text-[#176044]',
} as const;

/** The collector's sync state in words: Offline / Pending sync / Syncing... / Synced / Sync error. */
export function syncBadgeState(input: { offline: boolean; phase: string; waiting: number; failed: number }): { label: string; tone: keyof typeof TONES } {
  const { offline, phase, waiting, failed } = input;
  if (phase === 'syncing') return { label: 'Syncing…', tone: 'blue' };
  if (failed) return { label: `Sync error · ${failed}`, tone: 'red' };
  if (offline) return { label: waiting ? `Offline · ${waiting} pending` : 'Offline', tone: 'amber' };
  if (waiting) return { label: `Pending sync · ${waiting}`, tone: 'amber' };
  if (phase === 'error' || phase === 'blocked' || phase === 'auth-required') return { label: 'Sync error', tone: 'red' };
  return { label: 'Synced', tone: 'green' };
}

/** Offline / Pending sync / Syncing... / Synced / Sync error, in words (never colour alone). */
export function SyncBadge() {
  const c = useConnectivity();
  const sync = useSyncState();
  const offline = !c.network || c.server === 'unreachable';
  const { label, tone: toneKey } = syncBadgeState({
    offline, phase: sync.phase, waiting: sync.counts.pending + sync.counts.syncing, failed: sync.counts.failed + sync.counts.conflict,
  });
  const tone = TONES[toneKey];
  return (
    <Link
      href="/collector/sync"
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${tone}`}
    >
      {offline ? <CloudOff aria-hidden className="size-3.5" /> : <RefreshCw aria-hidden className={`size-3.5 ${sync.phase === 'syncing' ? 'animate-spin' : ''}`} />}
      {label}
    </Link>
  );
}

export function CollectorShell({
  children,
  cooperativeName,
  userName,
  userId,
}: {
  children: ReactNode;
  cooperativeName: string | null;
  userName: string | null;
  userId: string | null;
}) {
  const pathname = usePathname();
  const inWizard = pathname.startsWith('/collector/new');
  const online = useIsOnline();
  const options = useLocalQuery(() => coolerOptions(), ['coolers', 'collectors'], [online]);
  const coolers: ContextCooler[] = (options.data?.coolers ?? []).map((c) => ({
    id: c.id, name: c.name, code: c.code, location: c.centre_name, status: coolerStatus({ is_operational: c.is_operational }),
  }));
  const [coolerId, chooseCooler] = useWorkingCooler(`collector.${userId ?? ''}`, coolers.map((c) => c.id), options.data?.defaultCoolerId);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const load = () => inboxCount().then((r) => !cancelled && setUnread(r.unread), () => undefined);
    void load();
    const timer = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online, pathname]);
  const active = (href: string) => (href === '/collector' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-dvh bg-[#F6F7F4] text-[#17221D]">
      <header className="sticky top-0 z-30 border-b border-[#DDE3DE] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{cooperativeName ?? 'MilkOS'}</p>
            {userName && <p className="truncate text-xs text-[#5E6B64]">{userName}</p>}
          </div>
          <div className="flex items-center gap-1">
            <SyncBadge />
            <Link
              href="/collector/notifications"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              className="relative inline-flex size-11 items-center justify-center rounded-full text-[#5E6B64] hover:bg-[#EEF1EC]"
            >
              <Bell aria-hidden className="size-5" />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-[#B42318] px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-md px-4 pb-2">
          <CoolerSwitcher compact coolers={coolers} valueId={coolerId} onChange={chooseCooler} loading={options.data === null} />
        </div>
      </header>

      <main className={`mx-auto max-w-md px-4 pt-4 ${inWizard ? 'pb-8' : hasOwnNewCollection(pathname) ? 'pb-28' : 'pb-44'}`}>{children}</main>

      {!hasOwnNewCollection(pathname) && (
        <Link
          href="/collector/new"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-14 items-center gap-2 rounded-full bg-[#176044] px-5 text-base font-bold text-white shadow-lg outline-none active:bg-[#124D37] focus-visible:ring-2 focus-visible:ring-[#176044] focus-visible:ring-offset-2"
        >
          <Plus aria-hidden className="size-6" /> New Collection
        </Link>
      )}

      {!inWizard && (
        <nav aria-label="Collector" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[#DDE3DE] bg-white">
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const on = active(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={on ? 'page' : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:bg-[#EEF1EC] ${on ? 'text-[#176044]' : 'text-[#5E6B64]'}`}
                  >
                    <Icon aria-hidden className={`size-6 ${on ? 'stroke-[2.4]' : ''}`} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
