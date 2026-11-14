'use client';

// Always-visible cooperative / cooler context (spec §7). Status is always shown in words, never colour alone.
import React, { useEffect, useRef, useState } from 'react';

export type ContextStatus = 'online' | 'offline' | 'inactive';

export type ContextCooler = {
  id: string;
  name: string;
  code?: string;
  location?: string | null;
  status?: ContextStatus;
};

const STATUS_WORD: Record<ContextStatus, string> = { online: 'Online', offline: 'Offline', inactive: 'Inactive' };
const STATUS_DOT: Record<ContextStatus, string> = { online: 'bg-[#176044]', offline: 'bg-[#8A5A0B]', inactive: 'bg-[#8A948E]' };

export function coolerStatus(cooler: { status?: string | null; is_operational?: boolean | null } | null | undefined): ContextStatus {
  if (cooler?.status && cooler.status !== 'ACTIVE') return 'inactive';
  return cooler?.is_operational === false ? 'offline' : 'online';
}

export function tenantStatus(status: string | null | undefined): ContextStatus {
  return status === 'ACTIVE' ? 'online' : 'inactive';
}

function StatusBadge({ status }: { status: ContextStatus }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5E6B64]">
      <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_WORD[status]}
    </span>
  );
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function TenantSwitcher({
  name = '', code, location, status = 'online', logoUrl, compact,
}: { name?: string; code?: string; location?: string; status?: string; logoUrl?: string; compact?: boolean }) {
  const st: ContextStatus = status === 'offline' || status === 'inactive' ? status : 'online';
  const place = [code, location].filter(Boolean).join(' · ');
  return (
    <div aria-label={`Cooperative: ${name}`} role="group" className="flex min-w-0 items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
      ) : (
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E3F1E9] text-sm font-bold text-[#176044]">{initials(name)}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{name}</span>
        {!compact && place && <span className="block truncate text-xs text-[#5E6B64]">{place}</span>}
        <StatusBadge status={st} />
      </span>
    </div>
  );
}

export function CoolerSwitcher({
  coolers = [], valueId = null, onChange, loading = false, compact,
}: { coolers?: ContextCooler[]; valueId?: string | null; onChange?: (id: string) => void; loading?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = coolers.find((c) => c.id === valueId) ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!current) {
    return <p data-testid="cooler-switcher" className="text-sm text-[#5E6B64]">{loading ? 'Loading coolers…' : 'No coolers set up'}</p>;
  }

  const body = (
    <span className="min-w-0 text-left">
      <span className="block truncate text-sm font-bold">{current.name}</span>
      {!compact && current.location && <span className="block truncate text-xs text-[#5E6B64]">{current.location}</span>}
      <StatusBadge status={current.status ?? 'online'} />
    </span>
  );

  if (coolers.length < 2) {
    return <div data-testid="cooler-switcher" className="flex items-center gap-2">{body}</div>;
  }

  return (
    <div data-testid="cooler-switcher" ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#DDE3DE] bg-white px-3 py-2"
      >
        {body}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-label="Cooler" className="absolute z-20 mt-1 w-full rounded-xl border border-[#DDE3DE] bg-white p-1 shadow-lg">
          {coolers.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === current.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-[#F3F6F3]"
                onClick={() => { onChange?.(c.id); setOpen(false); }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{c.name}</span>
                  {c.location && <span className="block truncate text-xs text-[#5E6B64]">{c.location}</span>}
                </span>
                <StatusBadge status={c.status ?? 'online'} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
