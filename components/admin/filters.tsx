'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { inputClass, secondaryButton } from './ui';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label = 'Search',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-[14rem] flex-1 ${className}`}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8A968F]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={`${inputClass} pl-9 pr-8`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8A968F] hover:text-[#17221D]"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Adds a first option with value '' (e.g. "All statuses"). */
  allLabel?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-auto max-w-[16rem]`}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[#5E6B64]">
      <span className="whitespace-nowrap">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-auto`} />
    </label>
  );
}

/** Search box and filters above a table. */
export function FilterBar({ children, onReset, filtered }: { children: ReactNode; onReset?: () => void; filtered?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {onReset && filtered && (
        <button type="button" onClick={onReset} className="text-sm font-medium text-[#176044] hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  extra,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  extra?: ReactNode;
}) {
  if (total === 0 && !extra) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF1EC] px-4 py-3 text-sm text-[#5E6B64]">
      <span>
        {total === 0 ? 'No results' : <>Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}</>}
        {extra && <span className="ml-3">{extra}</span>}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} className={secondaryButton} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <button onClick={() => onPage(page + 1)} disabled={page >= pages} className={secondaryButton} aria-label="Next page">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </nav>
  );
}
