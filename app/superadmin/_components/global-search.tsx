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
  }
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
  const state: 'idle' | 'loading' | 'error' = !current ? 'loading' : current.failed ? 'error' : 'idle';

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    // "/" focuses search from anywhere (except while typing in a field).
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        box.current?.querySelector('input')?.focus();
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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showPanel = open && debounced.length >= 2;

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8A968F]" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-label="Search the platform"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search cooperatives, users, farmers, collectors, coolers, MC- references…   /"
        className="h-10 w-full rounded-lg border border-[#C9D2CB] bg-white pl-9 pr-3 text-sm outline-none placeholder:text-[#8A968F] focus:border-[#176044] focus:ring-2 focus:ring-[#176044]/20"
      />
      {showPanel && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#DDE3DE] bg-white py-1 shadow-xl">
          {state === 'loading' && results.length === 0 && <p className="px-4 py-3 text-sm text-[#5E6B64]">Searching…</p>}
          {state === 'error' && <p className="px-4 py-3 text-sm text-[#B42318]">Search failed. Try again.</p>}
          {state === 'idle' && results.length === 0 && <p className="px-4 py-3 text-sm text-[#5E6B64]">No matches for “{debounced}”.</p>}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
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
          ))}
        </div>
      )}
    </div>
  );
}
