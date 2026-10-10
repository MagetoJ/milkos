'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { globalSearch } from '../_api/superadmin-client';
import type { SearchResult, SearchType } from '../_types/platform-types';

const TYPE_LABEL: Record<SearchType, string> = {
  COOPERATIVE: 'Cooperative',
  USER: 'User',
  FARMER: 'Farmer',
  COLLECTOR: 'Collector',
  COOLER: 'Cooler',
  COLLECTION: 'Collection',
  BATCH: 'Collection batch',
  FARMER_PAYMENT: 'Farmer payment',
  SMS_PAYMENT: 'SMS payment',
  SMS_TRANSACTION: 'SMS credits',
  APPLICATION: 'Application',
  CORRECTION: 'Correction',
  REVERSAL: 'Reversal',
  DEVICE: 'Device',
  SCALE: 'Scale',
};

/** Where each kind of result opens. List pages open the record's panel from ?focus=<id>. */
export function resultHref(r: SearchResult): string {
  switch (r.type) {
    case 'COOPERATIVE':
      return `/superadmin/cooperatives/${r.id}`;
    case 'USER':
      return `/superadmin/users?focus=${r.id}`;
    case 'FARMER':
      return `/superadmin/farmers?focus=${r.id}`;
    case 'COLLECTOR':
      return `/superadmin/collectors?focus=${r.id}`;
    case 'COOLER':
      return `/superadmin/coolers?focus=${r.id}`;
    case 'COLLECTION':
      return `/superadmin/collections?focus=${r.id}`;
    case 'SMS_PAYMENT':
      return `/superadmin/payments?focus=${r.id}`;
    case 'APPLICATION':
      return `/superadmin/onboarding?focus=${r.id}`;
    case 'DEVICE':
      return '/superadmin/sync';
    case 'BATCH':
    case 'SCALE':
      return `/superadmin/collections?search=${encodeURIComponent(r.title)}`;
    default:
      // Payments, credits, corrections: the cooperative they belong to.
      return r.cooperative_id ? `/superadmin/cooperatives/${r.cooperative_id}` : '/superadmin';
  }
}

/** Navigation commands: the palette shows these first (all of them while the box is empty). */
export const COMMANDS: { label: string; href: string; keywords: string }[] = [
  { label: 'Dashboard', href: '/superadmin', keywords: 'home overview' },
  { label: 'Onboarding applications', href: '/superadmin/onboarding', keywords: 'applications approve review' },
  { label: 'Cooperatives', href: '/superadmin/cooperatives', keywords: 'coops tenants' },
  { label: 'Users & activation', href: '/superadmin/users', keywords: 'accounts invite pending activation suspend' },
  { label: 'Pending SMS payments', href: '/superadmin/payments', keywords: 'verify mpesa credits request information' },
  { label: 'Farmers', href: '/superadmin/farmers', keywords: 'members' },
  { label: 'Collectors', href: '/superadmin/collectors', keywords: 'staff' },
  { label: 'Coolers', href: '/superadmin/coolers', keywords: 'tanks temperature' },
  { label: 'Milk collections', href: '/superadmin/collections', keywords: 'batches deliveries' },
  { label: 'Sync & devices', href: '/superadmin/sync', keywords: 'offline phones' },
  { label: 'Reports', href: '/superadmin/reports', keywords: 'export csv excel' },
  { label: 'Audit log', href: '/superadmin/audit', keywords: 'history security events' },
  { label: 'Platform settings', href: '/superadmin/settings', keywords: 'configuration packages roles' },
  { label: 'My account & security', href: '/superadmin/settings/account', keywords: 'profile password two-step mfa phone sessions' },
];

export function matchCommands(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q)).slice(0, 5);
}

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  // The answer for one query; what to show while typing is derived from it.
  const [answer, setAnswer] = useState<{ query: string; results: SearchResult[]; failed: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 250);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.length < 2) return;
    let cancelled = false;
    globalSearch(debounced)
      .then((res) => {
        if (cancelled) return;
        setAnswer({ query: debounced, results: res.results, failed: false });
        setActive(0);
      })
      .catch(() => !cancelled && setAnswer({ query: debounced, results: [], failed: true }));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const current = answer && answer.query === debounced ? answer : null;
  const results = debounced.length >= 2 ? (current?.results ?? answer?.results ?? []) : [];
  const commands = matchCommands(q);
  const total = commands.length + results.length;
  const state: 'idle' | 'loading' | 'error' = !current ? 'loading' : current.failed ? 'error' : 'idle';

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    // "/" focuses search from anywhere (except while typing in a field).
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const palette = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (palette || (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag))) {
        e.preventDefault();
        box.current?.querySelector('input')?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function go(r: SearchResult) {
    setOpen(false);
    setQ('');
    router.push(resultHref(r));
  }

  function choose(index: number) {
    if (index < commands.length) {
      setOpen(false);
      setQ('');
      router.push(commands[index].href);
    } else if (results[index - commands.length]) {
      go(results[index - commands.length]);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active < total) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showPanel = open && (debounced.length >= 2 || commands.length > 0);

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8A968F]" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-label="Search the platform or jump to a page"
        aria-activedescendant={showPanel && total ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search or jump to…  (Ctrl K)"
        className="h-10 w-full rounded-lg border border-[#C9D2CB] bg-white pl-9 pr-3 text-sm outline-none placeholder:text-[#8A968F] focus:border-[#176044] focus:ring-2 focus:ring-[#176044]/20"
      />
      {showPanel && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#DDE3DE] bg-white py-1 shadow-xl">
          {commands.length > 0 && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-mo-subtle">Go to</p>}
          {commands.map((c, i) => (
            <button
              key={c.href}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? 'bg-[#F0F5F1]' : ''}`}
            >
              <span className="w-[5.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-mo-brand">Page</span>
              <span className="font-medium text-mo-ink">{c.label}</span>
            </button>
          ))}
          {debounced.length >= 2 && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-mo-subtle">Records</p>}
          {debounced.length >= 2 && state === 'loading' && results.length === 0 && <p className="px-4 py-3 text-sm text-[#5E6B64]">Searching…</p>}
          {debounced.length >= 2 && state === 'error' && <p className="px-4 py-3 text-sm text-[#B42318]">Search failed. Try again.</p>}
          {debounced.length >= 2 && state === 'idle' && results.length === 0 && <p className="px-4 py-3 text-sm text-[#5E6B64]">No matches for “{debounced}”.</p>}
          {results.map((r, j) => {
            const i = commands.length + j;
            return (
            <button
              key={`${r.type}-${r.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex w-full items-start gap-3 px-4 py-2 text-left ${i === active ? 'bg-[#F0F5F1]' : ''}`}
            >
              <span className="mt-0.5 w-[5.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#176044]">
                {TYPE_LABEL[r.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[#17221D]">{r.title}</span>
                <span className="block truncate text-xs text-[#5E6B64]">
                  {r.subtitle}
                  {r.context && <> · {r.context}</>}
                </span>
              </span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
