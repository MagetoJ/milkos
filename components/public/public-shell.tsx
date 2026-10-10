import type { ReactNode } from 'react';
import Link from 'next/link';
import { Milk } from 'lucide-react';

/** Frame for the public account pages (activation, password reset, application status). Shows no tenant data. */
export function PublicShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-mo-canvas text-mo-ink">
      <header className="border-b border-mo-line bg-mo-surface">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <Link href="/" className="inline-flex items-center gap-2 rounded font-semibold text-mo-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mo-brand/40">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-mo-brand text-white"><Milk aria-hidden className="size-4" /></span>
            MilkOS
          </Link>
          <Link href="/login" className="text-sm font-medium text-mo-brand underline-offset-2 hover:underline">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-mo-muted">{subtitle}</p>}
        <div className="mt-6 rounded-xl border border-mo-line bg-mo-surface p-5 shadow-sm">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-mo-subtle">MilkOS · Never share codes or links from MilkOS messages with anyone.</footer>
    </div>
  );
}
