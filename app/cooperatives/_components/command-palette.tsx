'use client';

// Cmd/Ctrl+K search for the cooperative workspace. Results come from the server, which returns only this
// cooperative's records and only those the signed-in role may see. Accessible combobox: arrow keys move,
// Enter opens, Escape closes; focus returns to where it was.
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { humanize } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { workspaceSearch, type SearchResult } from '../_api/finance-client';
import { useCoop } from './coop-context';

interface Command { label: string; href: string; keywords: string; adminOnly?: boolean }

/** Pages the palette can jump to. Admin-only pages are hidden from managers (the server refuses them anyway). */
const COMMANDS: Command[] = [
  { label: 'Overview', href: '/cooperatives', keywords: 'dashboard home trends' },
  { label: 'Record a collection', href: '/collector/new', keywords: 'new milk weigh allocate' },
  { label: 'Milk collections', href: '/collections', keywords: 'batches deliveries' },
  { label: 'Corrections & reversals', href: '/cooperatives/corrections', keywords: 'approve review' },
  { label: 'Farmers', href: '/cooperatives/farmers', keywords: 'members app access' },
  { label: 'Team & activation', href: '/cooperatives/team', keywords: 'managers collectors invite pending activation suspend' },
  { label: 'Collection centres', href: '/cooperatives/centres', keywords: 'places' },
  { label: 'Coolers', href: '/cooperatives/coolers', keywords: 'temperature sensors alerts' },
  { label: 'Farmer payments', href: '/cooperatives/payments', keywords: 'pay mpesa bank' },
  { label: 'Milk pricing', href: '/cooperatives/pricing', keywords: 'price per kg' },
  { label: 'SMS credits', href: '/cooperatives/sms-credits', keywords: 'buy balance ledger' },
  { label: 'Reports', href: '/cooperatives/reports', keywords: 'export csv excel' },
  { label: 'Notifications', href: '/cooperatives/notifications', keywords: 'inbox alerts' },
  { label: 'Cooperative settings', href: '/cooperatives/settings', keywords: 'organisation sms devices', adminOnly: true },
  { label: 'My account & security', href: '/cooperatives/settings', keywords: 'profile password two-step phone sessions' },
];

export function linkFor(r: SearchResult): string {
  const q = encodeURIComponent(r.title);
  switch (r.type) {
    case 'FARMER':
      return `/cooperatives/farmers?search=${encodeURIComponent(r.subtitle ?? r.title)}`;
    case 'CENTRE':
      return '/cooperatives/centres';
    case 'COLLECTOR':
      return '/cooperatives/operations';
    case 'COOLER':
    case 'SCALE':
      return '/cooperatives/coolers';
    case 'COLLECTION':
    case 'BATCH':
      return `/collections?search=${q}`;
    case 'FARMER_PAYMENT':
      return `/cooperatives/payments`;
    case 'SMS_PAYMENT':
    case 'SMS_TRANSACTION':
      return '/cooperatives/sms-credits';
    case 'CORRECTION':
    case 'REVERSAL':
      return '/cooperatives/corrections';
    case 'DEVICE':
      return '/cooperatives/sync';
    default:
      return '/cooperatives';
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { overview } = useCoop();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 200);
  // The answer for one search term; what's shown is derived from it (stale answers are ignored).
  const [answer, setAnswer] = useState<{ term: string; results: SearchResult[]; failed: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const results = answer && answer.term === term && term.length >= 2 ? answer.results : [];
  const lowered = q.trim().toLowerCase();
  const commands = COMMANDS
    .filter((c) => !c.adminOnly || overview.role === 'COOP_ADMIN')
    .filter((c) => !lowered || `${c.label} ${c.keywords}`.toLowerCase().includes(lowered))
    .slice(0, lowered ? 5 : COMMANDS.length);
  const total = commands.length + results.length;
  const state: 'idle' | 'loading' | 'error' = term.length < 2 ? 'idle' : answer?.term !== term ? 'loading' : answer.failed ? 'error' : 'idle';

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setTimeout(() => input.current?.focus(), 0);
    return () => returnFocus.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || term.length < 2) return;
    let cancelled = false;
    workspaceSearch(term).then(
      (r) => {
        if (cancelled) return;
        setAnswer({ term, results: r.results, failed: false });
        setActive(0);
      },
      () => {
        if (!cancelled) setAnswer({ term, results: [], failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [term, open]);

  if (!open) return null;

  function go(r: SearchResult | undefined) {
    if (!r) return;
    onClose();
    router.push(linkFor(r));
  }

  function choose(index: number) {
    if (index < commands.length) {
      onClose();
      router.push(commands[index].href);
    } else {
      go(results[index - commands.length]);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Search the workspace" className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[#EEF1EC] px-4">
          <Search aria-hidden className="size-5 text-[#8A968F]" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={total > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={active < total ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search or jump to a page"
            placeholder="Search farmers, collections… or jump to a page"
            className="min-h-14 flex-1 bg-transparent text-base outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, total - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(active);
              }
            }}
          />
          <button onClick={onClose} aria-label="Close search" className="rounded-md p-1.5 text-[#5E6B64] hover:bg-[#EEF1EC]"><X className="size-4" /></button>
        </div>
        <ul id={`${id}-list`} role="listbox" className="max-h-[60vh] overflow-y-auto py-2" aria-busy={state === 'loading'}>
          {commands.length > 0 && <li role="presentation" className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-mo-subtle">Go to</li>}
          {commands.map((c, i) => (
            <li key={c.label} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${i === active ? 'bg-[#EEF1EC]' : ''}`}>
              <span className="font-medium">{c.label}</span>
              <span className="shrink-0 rounded-full bg-mo-brand-soft px-2 py-0.5 text-[11px] font-semibold text-mo-brand">Page</span>
            </li>
          ))}
          {term.length < 2 && <li role="presentation" className="px-4 py-3 text-sm text-[#5E6B64]">Type at least 2 characters to search records. Searching needs a connection.</li>}
          {term.length >= 2 && state === 'error' && <li className="px-4 py-3 text-sm text-[#B42318]">Search is unavailable offline or the server can’t be reached.</li>}
          {term.length >= 2 && state === 'idle' && results.length === 0 && <li className="px-4 py-3 text-sm text-[#5E6B64]">No results.</li>}
          {results.map((r, j) => { const i = commands.length + j; return (
            <li
              key={`${r.type}-${r.id}-${j}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 ${i === active ? 'bg-[#EEF1EC]' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-[#5E6B64]">{[r.subtitle, r.context].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 rounded-full bg-[#EEF1EC] px-2 py-0.5 text-[11px] font-semibold text-[#3C4A43]">{humanize(r.type)}</span>
            </li>
          ); })}
        </ul>
      </div>
    </div>
  );
}

/** Opens the palette on Cmd+K / Ctrl+K. */
export function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
