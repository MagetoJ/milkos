'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { ErrorState, LoadingState } from './states';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Field name the API accepts in `sort`; makes the header clickable. */
  sortKey?: string;
  align?: 'left' | 'right';
  className?: string;
  hidden?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when there are no rows (after loading). */
  empty?: ReactNode;
  sort?: string;
  onSort?: (sort: string) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  minWidth?: string;
  /** Search and filters, above the table. */
  toolbar?: ReactNode;
  /** Pagination or a summary, below the table. */
  footer?: ReactNode;
  caption?: string;
}

/** One table architecture for every list in the admin: cooperatives, users, farmers, collections... */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  sort,
  onSort,
  onRowClick,
  rowClassName,
  minWidth = '760px',
  toolbar,
  footer,
  caption,
}: DataTableProps<T>) {
  const visible = columns.filter((c) => !c.hidden);
  const sortField = sort?.replace(/^-/, '');
  const descending = sort?.startsWith('-');

  function toggleSort(key: string) {
    if (!onSort) return;
    onSort(sortField === key && !descending ? `-${key}` : sortField === key && descending ? '' : key);
  }

  function onKey(event: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onRowClick(row);
    }
  }

  let body: ReactNode;
  if (error && !rows) body = <ErrorState message={error} onRetry={onRetry} />;
  else if (loading && !rows) body = <LoadingState />;
  else if (!rows || rows.length === 0) body = empty;
  else
    body = (
      <div className={`overflow-x-auto ${loading ? 'opacity-60 transition-opacity' : ''}`}>
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-[#EEF1EC] text-xs uppercase tracking-wide text-[#8A968F]">
            <tr>
              {visible.map((col, i) => {
                const active = col.sortKey && sortField === col.sortKey;
                const pad = i === 0 ? 'pl-5 pr-3' : i === visible.length - 1 ? 'pl-3 pr-5' : 'px-3';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (descending ? 'descending' : 'ascending') : undefined}
                    className={`${pad} py-3 font-medium ${col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.sortKey && onSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#17221D] ${active ? 'text-[#17221D]' : ''}`}
                      >
                        {col.header}
                        {active ? (
                          descending ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EC]">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`${onRowClick ? 'cursor-pointer outline-none hover:bg-[#F6F7F4] focus-visible:bg-[#F6F7F4] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#176044]' : ''} ${rowClassName?.(row) ?? ''}`}
              >
                {visible.map((col, i) => {
                  const pad = i === 0 ? 'pl-5 pr-3' : i === visible.length - 1 ? 'pl-3 pr-5' : 'px-3';
                  return (
                    <td key={col.key} className={`${pad} py-3 align-middle ${col.align === 'right' ? 'text-right tabular-nums' : ''} ${col.className ?? ''}`}>
                      {col.cell(row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <section className="rounded-xl border border-[#DDE3DE] bg-white">
      {toolbar && <div className="border-b border-[#EEF1EC] px-4 py-3">{toolbar}</div>}
      {error && rows && (
        <div className="border-b border-[#EEF1EC] px-4 py-3">
          <ErrorState message={error} onRetry={onRetry} compact />
        </div>
      )}
      {body}
      {footer}
    </section>
  );
}

/** First cell of a row: a name with a muted second line. */
export function PrimaryCell({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-[#17221D]">{title}</p>
      {subtitle && <p className="truncate text-xs text-[#8A968F]">{subtitle}</p>}
    </div>
  );
}

export const Muted = ({ children = '–' }: { children?: ReactNode }) => <span className="text-[#8A968F]">{children}</span>;
