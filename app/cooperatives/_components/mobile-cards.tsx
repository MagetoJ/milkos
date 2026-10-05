'use client';

// A list that is a table on wide screens and a stack of cards on phones (no horizontal scrolling).
import type { ReactNode } from 'react';
import { DataTable, type Column } from '@/components/admin';

export function MobileCards<T>({
  rows,
  rowKey,
  columns,
  loading,
  empty,
  footer,
}: {
  rows: T[] | null | undefined;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  loading?: boolean;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  return <DataTable columns={columns} rows={rows} rowKey={rowKey} loading={loading} empty={empty} footer={footer} minWidth="640px" mobileCards />;
}
