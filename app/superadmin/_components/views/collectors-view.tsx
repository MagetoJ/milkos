'use client';

import { useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  DetailList,
  DetailPanel,
  DetailRow,
  DetailSection,
  EmptyState,
  Field,
  FilterBar,
  FilterSelect,
  FormDialog,
  Muted,
  Pagination,
  PrimaryCell,
  SearchInput,
  StatusBadge,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
  type Column,
} from '@/components/admin';
import { formatDate, formatLitres, formatNumber, formatPhone } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { createCollector, getCollector, listCollectors, listCoolers, setCollectorStatus, updateCollector } from '../../_api/superadmin-client';
import type { Collector } from '../../_types/platform-types';
import { useToast } from '../toast';
import { ACTIVE_OPTIONS, useCooperativeOptions, useFocusParam, useFocusedRecord } from './common';

export function CollectorsView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const toast = useToast();
  const list = useListState({ filters: { cooperative_id: cooperativeId ?? '', status: '' } });
  const data = useResource(() => listCollectors(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [focus, setFocus] = useFocusParam();
  const [editing, setEditing] = useState<Collector | 'new' | null>(null);
  const [toggling, setToggling] = useState<Collector | null>(null);
  const focused = useFocusedRecord(focus, data.data?.items, getCollector);

  const columns: Column<Collector>[] = [
    { key: 'name', header: 'Collector', sortKey: 'name', cell: (c) => <PrimaryCell title={c.full_name} subtitle={c.collector_number} /> },
    { key: 'coop', header: 'Cooperative', sortKey: 'cooperative', hidden: !!cooperativeId, cell: (c) => c.cooperative_name },
    { key: 'phone', header: 'Phone', cell: (c) => <span className="whitespace-nowrap tabular-nums">{formatPhone(c.phone)}</span> },
    { key: 'area', header: 'Area', cell: (c) => c.assigned_area ?? <Muted /> },
    { key: 'cooler', header: 'Cooler', cell: (c) => c.cooler_name ?? <Muted>Not assigned</Muted> },
    { key: 'litres', header: 'Milk collected', align: 'right', cell: (c) => formatLitres(c.stats.total_litres) },
    { key: 'count', header: 'Collections', align: 'right', cell: (c) => formatNumber(c.stats.collections) },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Collectors</h1>
            <p className="mt-1 text-[#5E6B64]">The people who pick up milk from farmers, their routes, coolers and volumes.</p>
          </div>
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" /> New collector
          </button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(c) => c.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        sort={list.sort}
        onSort={list.setSort}
        onRowClick={(c) => setFocus(c.id)}
        rowClassName={(c) => (c.status === 'INACTIVE' ? 'text-[#8A968F]' : '')}
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, number, area or phone" label="Search collectors" />
            {!cooperativeId && <FilterSelect label="Cooperative" value={list.filters.cooperative_id} onChange={(v) => list.setFilter('cooperative_id', v)} allLabel="All cooperatives" options={coops} />}
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="Any status" options={ACTIVE_OPTIONS} />
            {embedded && (
              <button onClick={() => setEditing('new')} className={`${secondaryButton} ml-auto`}>
                <Plus className="size-4" /> Add collector
              </button>
            )}
          </FilterBar>
        }
        empty={<EmptyState icon={<Truck className="size-8" />} title={list.isFiltered ? 'No collectors match' : 'No collectors yet'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {focus && focused && (
        <DetailPanel
          title={focused.full_name}
          subtitle={`${focused.collector_number} · ${focused.cooperative_name ?? ''}`}
          badge={<StatusBadge status={focused.status} />}
          onClose={() => setFocus(null)}
          actions={
            <>
              <button onClick={() => setToggling(focused)} className={focused.status === 'ACTIVE' ? dangerButton : secondaryButton}>
                {focused.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </button>
              <button onClick={() => setEditing(focused)} className={primaryButton}>Edit</button>
            </>
          }
        >
          <DetailSection title="Assignment">
            <DetailList>
              <DetailRow label="Area" value={focused.assigned_area ?? 'Not set'} />
              <DetailRow label="Cooler" value={focused.cooler_name ?? 'Not assigned'} />
              <DetailRow label="Collection centre" value={focused.centre_name ?? 'Not assigned'} />
            </DetailList>
          </DetailSection>
          <DetailSection title="Contact">
            <DetailList>
              <DetailRow label="Phone" value={formatPhone(focused.phone)} />
              <DetailRow label="Email" value={focused.email} />
              <DetailRow label="Can sign in" value={focused.account_active ? 'Yes' : 'No'} />
            </DetailList>
          </DetailSection>
          <DetailSection title="Collection statistics">
            <DetailList>
              <DetailRow label="Accepted milk" value={formatLitres(focused.stats.total_litres)} />
              <DetailRow label="Collections" value={formatNumber(focused.stats.collections)} />
              <DetailRow label="Last collection" value={focused.stats.last_collection ? formatDate(focused.stats.last_collection) : 'None'} />
            </DetailList>
          </DetailSection>
        </DetailPanel>
      )}
      {toggling && (
        <ConfirmationDialog
          title={toggling.status === 'ACTIVE' ? `Deactivate ${toggling.full_name}?` : `Reactivate ${toggling.full_name}?`}
          body={toggling.status === 'ACTIVE' ? 'They can no longer sign in or record milk. Collections they recorded stay.' : 'They can sign in and record milk again.'}
          confirmLabel={toggling.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
          danger={toggling.status === 'ACTIVE'}
          reason={{ label: 'Reason' }}
          onClose={() => setToggling(null)}
          onConfirm={async (reason) => {
            await setCollectorStatus(toggling.id, toggling.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason || undefined);
            toast(`${toggling.full_name} ${toggling.status === 'ACTIVE' ? 'deactivated' : 'reactivated'}.`);
            setToggling(null);
            await data.reload();
          }}
        />
      )}
      {editing && (
        <CollectorForm
          collector={editing === 'new' ? null : editing}
          cooperativeId={cooperativeId}
          onClose={() => setEditing(null)}
          onSaved={(c, created) => {
            setEditing(null);
            toast(`${c.full_name} ${created ? 'added' : 'updated'}.`);
            void data.reload();
            setFocus(c.id);
          }}
        />
      )}
    </>
  );
}

function CollectorForm({
  collector,
  cooperativeId,
  onClose,
  onSaved,
}: {
  collector: Collector | null;
  cooperativeId?: string;
  onClose: () => void;
  onSaved: (c: Collector, created: boolean) => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const coops = useCooperativeOptions(!cooperativeId && !collector);
  const [f, setF] = useState({
    cooperative_id: collector?.cooperative_id ?? cooperativeId ?? '',
    full_name: collector?.full_name ?? '',
    email: collector?.email ?? '',
    phone: collector ? formatPhone(collector.phone) : '',
    collector_number: collector?.collector_number ?? '',
    assigned_area: collector?.assigned_area ?? '',
    cooler_id: collector?.cooler_id ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const coolers = useResource(
    () => (f.cooperative_id ? listCoolers({ cooperative_id: f.cooperative_id, status: 'ACTIVE', page_size: 100 }) : Promise.resolve(null)),
    [f.cooperative_id],
  );

  async function submit() {
    let saved: Collector | undefined;
    const ok = await run(async () => {
      if (collector) {
        saved = await updateCollector(collector.id, {
          full_name: f.full_name,
          phone: f.phone,
          collector_number: f.collector_number,
          assigned_area: f.assigned_area || null,
          cooler_id: f.cooler_id || null,
        });
      } else {
        saved = await createCollector({
          cooperative_id: f.cooperative_id,
          full_name: f.full_name,
          email: f.email.trim() || null,
          phone: f.phone,
          assigned_area: f.assigned_area || null,
          cooler_id: f.cooler_id || null,
          ...(f.collector_number.trim() ? { collector_number: f.collector_number } : {}),
        });
      }
    });
    if (ok && saved) onSaved(saved, !collector);
  }

  return (
    <FormDialog title={collector ? `Edit ${collector.full_name}` : 'New collector'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel={collector ? 'Save changes' : 'Add collector'} wide>
      {!collector && !cooperativeId && (
        <Field label="Cooperative" required error={fieldErrors.cooperative_id}>
          {(p) => (
            <select {...p} className={inputClass} value={f.cooperative_id} onChange={(e) => setF({ ...f, cooperative_id: e.target.value, cooler_id: '' })}>
              <option value="">Choose a cooperative</option>
              {coops.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={fieldErrors.full_name}>
          {(p) => <input {...p} className={inputClass} value={f.full_name} onChange={set('full_name')} autoFocus />}
        </Field>
        <Field label="Phone" required error={fieldErrors.phone}>
          {(p) => <input {...p} type="tel" className={inputClass} value={f.phone} onChange={set('phone')} placeholder="0712 345 678" />}
        </Field>
        {!collector && (
          <>
            <Field label="Email (optional)" error={fieldErrors.email} hint="Collectors can sign in with their phone number.">
              {(p) => <input {...p} type="email" className={inputClass} value={f.email} onChange={set('email')} />}
            </Field>
            <p className="self-end text-sm text-mo-muted">An SMS activation link is sent to the phone above; the collector chooses their own password.</p>
          </>
        )}
        <Field label="Assigned area / route" error={fieldErrors.assigned_area}>
          {(p) => <input {...p} className={inputClass} value={f.assigned_area} onChange={set('assigned_area')} placeholder="e.g. Tigoni ridge" />}
        </Field>
        <Field label="Delivers to cooler" error={fieldErrors.cooler_id}>
          {(p) => (
            <select {...p} className={inputClass} value={f.cooler_id} onChange={set('cooler_id')} disabled={!f.cooperative_id}>
              <option value="">Not assigned</option>
              {(coolers.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          )}
        </Field>
        <Field label="Collector number" error={fieldErrors.collector_number} hint={collector ? undefined : 'Blank = next number (COL-001).'}>
          {(p) => <input {...p} className={inputClass} value={f.collector_number} onChange={set('collector_number')} />}
        </Field>
      </div>
    </FormDialog>
  );
}
