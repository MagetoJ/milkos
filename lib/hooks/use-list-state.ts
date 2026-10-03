'use client';

import { useCallback, useState } from 'react';
import { useDebounced } from './use-debounced';

export type Filters = Record<string, string>;

/**
 * Page, page size, search, sort and filters for a server-side list.
 * Changing anything except the page goes back to page 1.
 */
export function useListState(initial: { filters?: Filters; sort?: string; pageSize?: number } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initial.pageSize ?? 25);
  const [search, setSearchState] = useState('');
  const [sort, setSortState] = useState(initial.sort ?? '');
  const [filters, setFilters] = useState<Filters>(initial.filters ?? {});
  const debouncedSearch = useDebounced(search);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);
  const setFilter = useCallback((key: string, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }, []);
  const setSort = useCallback((value: string) => {
    setSortState(value);
    setPage(1);
  }, []);
  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    setPage(1);
  }, []);
  const reset = useCallback(() => {
    setSearchState('');
    setFilters(initial.filters ?? {});
    setSortState(initial.sort ?? '');
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFiltered =
    !!debouncedSearch.trim() ||
    Object.entries(filters).some(([key, value]) => value !== (initial.filters?.[key] ?? ''));

  return {
    page, setPage, pageSize, setPageSize, search, setSearch, debouncedSearch, sort, setSort,
    filters, setFilter, reset, isFiltered,
    /** Query parameters for the API. */
    params: { page, page_size: pageSize, search: debouncedSearch.trim(), sort, ...filters },
  };
}
