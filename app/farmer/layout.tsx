'use client';

// The farmer's app: phone-first, simple, read-only for everything the cooperative controls.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote, History, Home, LogOut, Settings, type LucideIcon } from 'lucide-react';
import { useActiveRefresh } from '@/app/hooks/use-active-refresh';
import { homeFor, loginUrl } from '@/lib/auth';
import { bootSession, signOutEverywhere } from '@/lib/offline/auth';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/farmer', label: 'Home', icon: Home },
  { href: '/farmer/collections', label: 'Deliveries', icon: History },
  { href: '/farmer/payments', label: 'Payments', icon: Banknote },
  { href: '/farmer/settings', label: 'Settings', icon: Settings },
];

type State = { status: 'checking' } | { status: 'blocked'; message: string } | { status: 'ok'; name: string };

export default function FarmerLayout({ children }: { children: ReactNode }) {
  useActiveRefresh();
  const pathname = usePathname();
  const [state, setState] = useState<State>({ status: 'checking' });

  useEffect(() => {
    void bootSession(['FARMER']).then((boot) => {
      if (boot.mode === 'login') return window.location.replace(loginUrl(pathname));
      if (boot.mode === 'wrong-role') return window.location.replace(homeFor(boot.role));
      if (boot.mode === 'blocked') return setState({ status: 'blocked', message: boot.message });
      if (boot.mode === 'unreachable') return setState({ status: 'blocked', message: "Can't reach MilkOS. Check your connection and try again." });
      setState({ status: 'ok', name: boot.mode === 'online' ? boot.me.full_name : boot.session.user.full_name });
    });
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'checking') {
    return <div className="flex min-h-dvh items-center justify-center bg-mo-canvas text-sm text-mo-muted" role="status">Checking your access…</div>;
  }
  if (state.status === 'blocked') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mo-canvas px-6 text-center">
        <p className="max-w-sm">{state.message}</p>
        <button onClick={() => window.location.reload()} className="min-h-12 rounded-xl bg-mo-brand px-5 font-semibold text-white">Try again</button>
      </div>
    );
  }
  const active = (href: string) => (href === '/farmer' ? pathname === href : pathname.startsWith(href));
  return (
    <div className="min-h-dvh bg-mo-canvas text-mo-ink">
      <header className="sticky top-0 z-30 border-b border-mo-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-2.5">
          <p className="truncate text-sm font-semibold">{state.name}</p>
          <button
            type="button"
            onClick={async () => { await signOutEverywhere(); window.location.assign('/login'); }}
            aria-label="Sign out"
            className="inline-flex size-11 items-center justify-center rounded-full text-mo-muted hover:bg-mo-hover"
          >
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pb-28 pt-4">{children}</main>
      <nav aria-label="Farmer" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-mo-line bg-white">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            return (
              <li key={href}>
                <Link href={href} aria-current={on ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${on ? 'text-mo-brand' : 'text-mo-muted'}`}>
                  <Icon aria-hidden className={`size-6 ${on ? 'stroke-[2.4]' : ''}`} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
