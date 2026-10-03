'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ScrollText } from 'lucide-react';
import {
  DataTable,
  DetailList,
  DetailPanel,
  DetailRow,
  DetailSection,
  EmptyState,
  FilterBar,
  FilterDate,
  FilterSelect,
  Muted,
  Pagination,
  PrimaryCell,
  SearchInput,
  roleLabel,
  type Column,
} from '@/components/admin';
import { formatDateTime, humanize } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { listAuditLogs } from '../../_api/superadmin-client';
import type { AuditEntry } from '../../_types/platform-types';
import { ValuesDiff, useCooperativeOptions } from './common';

const ENTITY_TYPES = ['application', 'cooperative', 'user', 'farmer', 'collector', 'cooler', 'collection', 'payment', 'centre', 'settings', 'sms_package'];
const ROLES = ['SUPER_ADMIN', 'COOP_ADMIN', 'MANAGER', 'COLLECTOR', 'FARMER'];

const TONE: Record<string, string> = {
  CREATED: 'bg-[#176044]',
  APPROVED: 'bg-[#176044]',
  VERIFIED: 'bg-[#176044]',
  ACTIVATED: 'bg-[#176044]',
  RECORDED: 'bg-[#176044]',
  REJECTED: 'bg-[#B42318]',
  SUSPENDED: 'bg-[#B42318]',
  DISABLED: 'bg-[#B42318]',
  DEACTIVATED: 'bg-[#B42318]',
};

function dot(action: string) {
  const suffix = action.split('_').pop() ?? '';
  return TONE[suffix] ?? 'bg-[#8A968F]';
}

export function AuditView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const params = useSearchParams();
  const list = useListState({
    filters: {
      cooperative_id: cooperativeId ?? '',
      action: '',
      entity_type: params.get('entity_type') ?? '',
      entity_id: params.get('entity_id') ?? '',
      actor_role: '',
      date_from: '',
      date_to: '',
    },
  });
  const data = useResource(() => listAuditLogs(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'When', cell: (e) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(e.created_at)}</span> },
    {
      key: 'action',
      header: 'Action',
      cell: (e) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className={`size-2 rounded-full ${dot(e.action)}`} />
          {humanize(e.action)}
        </span>
      ),
    },
    { key: 'target', header: 'Details', className: 'max-w-[22rem]', cell: (e) => <span className="line-clamp-2">{e.target}</span> },
    { key: 'actor', header: 'By', cell: (e) => <PrimaryCell title={e.actor_email ?? 'Deleted account'} subtitle={roleLabel(e.actor_role)} /> },
    { key: 'coop', header: 'Cooperative', hidden: !!cooperativeId, cell: (e) => e.cooperative_name ?? <Muted>Platform</Muted> },
  ];

  return (
    <>
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-[#5E6B64]">An append-only record of every administrative change: who, what, before and after, from where.</p>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(e) => e.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        onRowClick={setOpen}
        minWidth="860px"
        toolbar={
          <div className="space-y-3">
            <FilterBar onReset={list.reset} filtered={list.isFiltered}>
              <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search details, actor email or action" label="Search audit log" />
              <FilterSelect label="Action" value={list.filters.action} onChange={(v) => list.setFilter('action', v)} allLabel="All actions" options={(data.data?.actions ?? []).map((a) => ({ value: a, label: humanize(a) }))} />
              <FilterSelect label="Record type" value={list.filters.entity_type} onChange={(v) => { list.setFilter('entity_type', v); list.setFilter('entity_id', ''); }} allLabel="All records" options={ENTITY_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
            </FilterBar>
            <div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Actor role" value={list.filters.actor_role} onChange={(v) => list.setFilter('actor_role', v)} allLabel="Any role" options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} />
              {!cooperativeId && <FilterSelect label="Cooperative" value={list.filters.cooperative_id} onChange={(v) => list.setFilter('cooperative_id', v)} allLabel="All cooperatives" options={coops} />}
              <FilterDate label="From" value={list.filters.date_from} onChange={(v) => list.setFilter('date_from', v)} />
              <FilterDate label="To" value={list.filters.date_to} onChange={(v) => list.setFilter('date_to', v)} />
              {list.filters.entity_id && (
                <button onClick={() => list.setFilter('entity_id', '')} className="rounded-full bg-[#E3F1E9] px-2.5 py-1 text-xs font-medium text-[#176044]">
                  One record only ✕
                </button>
              )}
            </div>
          </div>
        }
        empty={<EmptyState icon={<ScrollText className="size-8" />} title={list.isFiltered ? 'No entries match' : 'Nothing recorded yet'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />
      {open && (
        <DetailPanel title={humanize(open.action)} subtitle={formatDateTime(open.created_at)} onClose={() => setOpen(null)}>
          <p className="text-sm">{open.target}</p>
          <DetailSection title="Who">
            <DetailList>
              <DetailRow label="Actor" value={open.actor_email ?? 'Deleted account'} />
              <DetailRow label="Role" value={roleLabel(open.actor_role)} />
              <DetailRow label="IP address" value={open.ip_address ?? '–'} />
              <DetailRow label="Device" value={<span className="text-xs">{open.user_agent ?? '–'}</span>} />
            </DetailList>
          </DetailSection>
          <DetailSection title="What">
            <DetailList>
              <DetailRow label="Record" value={open.entity_type ? `${humanize(open.entity_type)} ${open.entity_id ?? ''}` : '–'} />
              <DetailRow
                label="Cooperative"
                value={open.cooperative_id ? <Link className="text-[#176044] hover:underline" href={`/superadmin/cooperatives/${open.cooperative_id}`}>{open.cooperative_name ?? open.cooperative_id}</Link> : 'Platform'}
              />
            </DetailList>
            {(open.old_values || open.new_values) && (
              <div className="mt-3 rounded-lg border border-[#EEF1EC] px-3 pb-2">
                <ValuesDiff entry={open} />
              </div>
            )}
          </DetailSection>
        </DetailPanel>
      )}
    </>
  );
}
