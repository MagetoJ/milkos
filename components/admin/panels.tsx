'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { X, type LucideIcon } from 'lucide-react';

/** A headline number. Give it `href` to make the whole card a link to the list behind it. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'warning' | 'danger' | 'good';
  href?: string;
}) {
  const toneClass = {
    default: 'text-[#17221D]',
    good: 'text-[#176044]',
    warning: 'text-[#8A5A0B]',
    danger: 'text-[#B42318]',
  }[tone];
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[#5E6B64]">{label}</span>
        {Icon && <Icon className="size-4 text-[#8A968F]" aria-hidden />}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[#8A968F]">{hint}</div>}
    </>
  );
  const base = 'block rounded-xl border border-[#DDE3DE] bg-white px-5 py-4';
  return href ? (
    <Link href={href} className={`${base} outline-none transition-colors hover:border-[#B8C4BC] focus-visible:ring-2 focus-visible:ring-[#176044]`}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

/** Side drawer for viewing one record without leaving the list. */
export function DetailPanel({
  title,
  subtitle,
  badge,
  onClose,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-[#0F3325]/30" onClick={onClose} aria-hidden />
      <section className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#DDE3DE] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-lg font-semibold leading-snug">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="mt-0.5 text-sm text-[#5E6B64]">{subtitle}</p>}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[#5E6B64] hover:bg-[#EEF1EC]">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">{children}</div>
        {actions && <footer className="flex flex-wrap justify-end gap-2 border-t border-[#DDE3DE] px-6 py-4">{actions}</footer>}
      </section>
    </div>
  );
}

export function DetailSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8A968F]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-[#EEF1EC] rounded-lg border border-[#EEF1EC]">{children}</dl>;
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 px-3 py-2.5 text-sm">
      <dt className="text-[#5E6B64]">{label}</dt>
      <dd className="min-w-0 break-words text-[#17221D]">{value ?? '–'}</dd>
    </div>
  );
}

/** Tabs that keep their state in the URL hash, so a tab can be linked to and survives a reload. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" aria-label="Sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-[#DDE3DE] px-1">
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm outline-none focus-visible:bg-[#EEF1EC] ${
              selected ? 'border-[#176044] font-medium text-[#17221D]' : 'border-transparent text-[#5E6B64] hover:text-[#17221D]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ml-1.5 tabular-nums text-[#8A968F]">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
