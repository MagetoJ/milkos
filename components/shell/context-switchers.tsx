'use client';

// Always-visible context (spec §7): which cooperative and which cooler the person is working in, with name/logo,
// location and status. The cooler can be switched when there is more than one; a person belongs to exactly one
// cooperative today, so the cooperative is shown, not switched.
import { useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, CircleAlert, CircleCheck, CircleSlash, Snowflake } from 'lucide-react';
import { useDismiss } from './use-dismiss';

export type ContextStatus = 'online' | 'offline' | 'inactive';

const STATUS: Record<ContextStatus, { label: string; icon: typeof CircleCheck; tone: string }> = {
  online: { label: 'Online', icon: CircleCheck, tone: 'text-mo-brand' },
  offline: { label: 'Offline', icon: CircleAlert, tone: 'text-mo-warn' },
  inactive: { label: 'Inactive', icon: CircleSlash, tone: 'text-mo-subtle' },
};

/** Status is never colour alone: icon + word. */
export function StatusLabel({ status, className = '' }: { status: ContextStatus; className?: string }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${tone} ${className}`}><Icon aria-hidden className="size-3.5" />{label}</span>;
}

export interface ContextCooler {
  id: string;
  name: string;
  code?: string | null;
  /** Place of the cooler: its location, else its collection centre. */
  location: string | null;
  status: ContextStatus;
}

/** Cooperative logo when there is one, otherwise its initials. */
function Mark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'M';
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
    : <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-mo-brand text-xs font-bold text-white">{initials}</span>;
}

export function TenantSwitcher({ name, code, location, status, logoUrl, compact = false }: {
  name: string; code?: string | null; location?: string | null; status: ContextStatus; logoUrl?: string | null;
  /** Name only (small screens). */
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" role="group" aria-label={`Cooperative: ${name}`}>
      <Mark name={name} logoUrl={logoUrl} />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-mo-ink" title={name}>{name}</p>
        {!compact && (
          <p className="flex items-center gap-1.5 truncate text-xs text-mo-muted">
            <span className="truncate">{[code, location].filter(Boolean).join(' · ')}</span>
            <StatusLabel status={status} />
          </p>
        )}
      </div>
    </div>
  );
}

export function CoolerSwitcher({ coolers, valueId, onChange, loading = false, compact = false }: {
  coolers: ContextCooler[]; valueId: string | null; onChange: (id: string) => void; loading?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(wrap, open, () => setOpen(false));
  const current = coolers.find((c) => c.id === valueId) ?? null;

  if (loading && !current) return <span role="status" className="text-xs text-mo-muted">Loading coolers…</span>;
  if (!coolers.length) return <span className="inline-flex items-center gap-1.5 text-xs text-mo-muted"><Snowflake aria-hidden className="size-4" />No coolers set up</span>;

  const label = (c: ContextCooler) => (
    <span className="flex min-w-0 items-center gap-2">
      <Snowflake aria-hidden className="size-4 shrink-0 text-mo-brand" />
      <span className="min-w-0 text-left leading-tight">
        <span className="block truncate text-sm font-semibold text-mo-ink">{c.name}</span>
        {!compact && (
          <span className="flex items-center gap-1.5 truncate text-xs text-mo-muted">
            {c.location && <span className="truncate">{c.location}</span>}
            <StatusLabel status={c.status} />
          </span>
        )}
      </span>
    </span>
  );

  // One cooler: nothing to switch, just show it.
  if (coolers.length === 1 && current) return <div role="group" aria-label={`Cooler: ${current.name}`}>{label(current)}</div>;

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={`Cooler: ${current?.name ?? 'none selected'}. Change cooler`}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-mo-line bg-mo-surface px-2.5 py-1 text-left outline-none hover:bg-mo-hover focus-visible:ring-2 focus-visible:ring-mo-brand/40"
      >
        {current ? label(current) : <span className="text-sm text-mo-muted">Choose a cooler</span>}
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-mo-subtle" />
      </button>
      {open && (
        <ul
          id={listId} role="listbox" aria-label="Coolers" onKeyDown={onKeyDown}
          className="absolute right-0 z-50 mt-1 max-h-72 w-72 max-w-[90vw] overflow-y-auto rounded-lg border border-mo-line bg-mo-surface p-1 shadow-lg"
        >
          {coolers.map((c, i) => {
            const selected = c.id === valueId;
            return (
              <li
                key={c.id} role="option" aria-selected={selected} tabIndex={selected || (!current && i === 0) ? 0 : -1}
                ref={(el) => { if (el && selected) queueMicrotask(() => el.focus()); }}
                onClick={() => { onChange(c.id); setOpen(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(c.id); setOpen(false); } }}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 outline-none hover:bg-mo-hover focus-visible:bg-mo-hover focus-visible:ring-2 focus-visible:ring-mo-brand/40"
              >
                {label(c)}
                {selected && <Check aria-hidden className="size-4 shrink-0 text-mo-brand" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Maps a cooler record's flags to the status words used everywhere. */
export function coolerStatus(c: { status?: string | null; is_operational?: boolean | null }): ContextStatus {
  if (c.status && c.status !== 'ACTIVE') return 'inactive';
  return c.is_operational === false ? 'offline' : 'online';
}

/** Cooperative status words (ACTIVE / SUSPENDED / ...) -> context status. */
export function tenantStatus(status: string | null | undefined): ContextStatus {
  return !status || status === 'ACTIVE' ? 'online' : 'inactive';
}
