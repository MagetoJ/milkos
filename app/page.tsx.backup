'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CloudOff, MessageSquareText, Milk, ShieldCheck, Snowflake } from 'lucide-react';
import { getSession, homeFor } from '@/lib/auth';

const FEATURES = [
  { icon: Milk, title: 'Collections that add up', body: 'Weigh once, allocate to every farmer exactly, and send each one an SMS receipt.' },
  { icon: CloudOff, title: 'Works offline', body: 'Collectors keep recording at the centre with no network; everything syncs when the phone reconnects.' },
  { icon: Snowflake, title: 'Cooler monitoring', body: 'Temperature and volume alerts before milk is lost.' },
  { icon: BarChart3, title: 'Payments and reports', body: 'Historical prices, corrections and reversals that never rewrite history.' },
  { icon: MessageSquareText, title: 'SMS credits you can trust', body: 'One ledger: every credit bought, used or refunded is accounted for.' },
  { icon: ShieldCheck, title: 'Secure accounts', body: 'Phone-verified activation, two-step verification and full audit trails.' },
];

/**
 * The public landing page. A signed-in user goes straight to their workspace (each section re-checks the role with
 * the backend); everyone else sees what MilkOS is and how to sign in or apply. No cooperative data is shown here.
 */
export default function HomePage() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session) {
      window.location.replace(homeFor(session.role));
      return;
    }
    setChecked(true);
  }, []);

  if (!checked) {
    return <div className="flex h-screen items-center justify-center text-sm text-mo-muted" role="status">Loading…</div>;
  }

  return (
    <div className="min-h-dvh bg-mo-canvas text-mo-ink">
      <header className="border-b border-mo-line bg-mo-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="inline-flex items-center gap-2 text-lg font-semibold text-mo-brand">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-mo-brand text-white"><Milk aria-hidden className="size-5" /></span>
            MilkOS
          </span>
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link href="/application-status" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-mo-muted hover:bg-mo-hover sm:inline-flex">Application status</Link>
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-mo-brand px-4 text-sm font-semibold text-white hover:bg-mo-brand-strong">Sign in</Link>
          </nav>
        </div>
      </header>
      <main>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wide text-mo-brand">The operating system for dairy cooperatives</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Every litre, every farmer, every shilling accounted for.</h1>
          <p className="mt-4 max-w-2xl text-lg text-mo-muted">
            MilkOS runs milk collection, cooler monitoring, farmer payments and SMS receipts for cooperatives across Kenya, online or off.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex min-h-12 items-center rounded-lg bg-mo-brand px-5 font-semibold text-white hover:bg-mo-brand-strong">Apply for your cooperative</Link>
            <Link href="/login" className="inline-flex min-h-12 items-center rounded-lg border border-mo-line-strong bg-mo-surface px-5 font-semibold hover:bg-mo-hover">Sign in</Link>
            <Link href="/activate-account" className="inline-flex min-h-12 items-center rounded-lg px-5 font-semibold text-mo-brand underline-offset-2 hover:underline">Activate an account</Link>
          </div>
        </section>
        <section aria-labelledby="features" className="border-t border-mo-line bg-mo-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="features" className="text-2xl font-semibold">Built for the collection centre and the office</h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-xl border border-mo-line p-5">
                  <Icon aria-hidden className="size-6 text-mo-brand" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-mo-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-mo-subtle">© MilkOS</footer>
    </div>
  );
}
