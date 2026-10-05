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
  /** Leave this column out of the mobile card (e.g. an icon-only column). */
  hideOnCard?: boolean;
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
  /**
   * Below the `md` breakpoint, show each row as a card instead of a wide table. `true` builds the card from
   * the columns (first column as the title, the rest as label/value pairs); a function renders a custom card.
   */
  mobileCards?: boolean | ((row: T) => ReactNode);
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
  mobileCards,
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
      <>
      {mobileCards && (
        <ul className={`divide-y divide-[#EEF1EC] md:hidden ${loading ? 'opacity-60' : ''}`} aria-label={caption}>
          {rows.map((row) => (
            <li key={rowKey(row)}>
              {typeof mobileCards === 'function' ? (
                mobileCards(row)
              ) : (
                <AutoCard row={row} columns={visible} onClick={onRowClick ? () => onRowClick(row) : undefined} />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={`overflow-x-auto ${mobileCards ? 'hidden md:block' : ''} ${loading ? 'opacity-60 transition-opacity' : ''}`}>
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
      </>
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

/** A row as a card: the first column is the title, the others are label / value pairs. */
function AutoCard<T>({ row, columns, onClick }: { row: T; columns: Column<T>[]; onClick?: () => void }) {
  const [first, ...rest] = columns.filter((c) => !c.hideOnCard);
  const content = (
    <>
      {first && <div className="mb-2 text-sm">{first.cell(row)}</div>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {rest.map((col) => {
          const value = col.cell(row);
          if (value === null || value === undefined || value === '') return null;
          return (
            <div key={col.key} className={col.header ? '' : 'col-span-2'}>
              {col.header ? <dt className="text-xs text-[#8A968F]">{col.header}</dt> : null}
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          );
        })}
      </dl>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full px-4 py-3 text-left hover:bg-[#F6F7F4]">{content}</button>
  ) : (
    <div className="px-4 py-3">{content}</div>
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
