'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDateTime, humanize } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { roleLabel } from '@/components/admin';
import { cooperativeOptions } from '../../_api/superadmin-client';
import type { AuditEntry } from '../../_types/platform-types';

/** ?focus=<id> opens a record's panel (links from global search); closing removes it from the URL. */
export function useFocusParam(): [string | null, (id: string | null) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const focus = params.get('focus');

  const setFocus = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (id) next.set('focus', id);
      else next.delete('focus');
      const qs = next.toString();
      router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false });
    },
    [router],
  );
  return [focus, setFocus];
}

/** All cooperatives as select options, loaded once per view. */
export function useCooperativeOptions(enabled = true) {
  const res = useResource(() => (enabled ? cooperativeOptions() : Promise.resolve([])), [enabled]);
  return res.data ?? [];
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Old → new values of one audit entry. */
export function ValuesDiff({ entry }: { entry: AuditEntry }) {
  const keys = Array.from(new Set([...Object.keys(entry.old_values ?? {}), ...Object.keys(entry.new_values ?? {})]));
  if (keys.length === 0) return null;
  return (
    <table className="mt-2 w-full text-xs">
      <thead className="text-left text-[#8A968F]">
        <tr>
          <th className="py-1 pr-2 font-medium">Field</th>
          <th className="py-1 pr-2 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-[#EEF1EC] align-top">
            <td className="py-1 pr-2 text-[#5E6B64]">{humanize(k)}</td>
            <td className="break-all py-1 pr-2 text-[#B42318]/80">{entry.old_values && k in entry.old_values ? renderValue(entry.old_values[k]) : '–'}</td>
            <td className="break-all py-1 text-[#176044]">{entry.new_values && k in entry.new_values ? renderValue(entry.new_values[k]) : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Compact audit history for a detail panel. */
export function AuditTrail({ entries, empty = 'No recorded changes yet.' }: { entries: AuditEntry[]; empty?: string }) {
  if (entries.length === 0) return <p className="text-sm text-[#5E6B64]">{empty}</p>;
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="rounded-lg border border-[#EEF1EC] p-3 text-sm">
          <p>
            <span className="font-medium">{humanize(e.action)}</span>
            <span className="text-[#5E6B64]"> · {e.target}</span>
          </p>
          <p className="text-xs text-[#8A968F]">
            {formatDateTime(e.created_at)} by {e.actor_email ?? 'a deleted account'}
            {e.actor_role && ` (${roleLabel(e.actor_role)})`}
          </p>
          <ValuesDiff entry={e} />
        </li>
      ))}
    </ol>
  );
}

export const ACTIVE_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

/** The focused record: taken from the loaded page when it's there, otherwise fetched by id. */
export function useFocusedRecord<T extends { id: string }>(
  focus: string | null,
  items: T[] | undefined,
  fetchOne: (id: string) => Promise<T>,
): T | undefined {
  const onPage = focus ? items?.find((item) => item.id === focus) : undefined;
  const fetched = useResource(
    () => (focus && items && !onPage ? fetchOne(focus) : Promise.resolve(null)),
    [focus, !!items, !!onPage],
  );
  return onPage ?? (fetched.data && fetched.data.id === focus ? fetched.data : undefined);
}
