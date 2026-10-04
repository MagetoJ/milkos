'use client';

import { useReloadOn } from '@/lib/sync/hooks';
import { useState } from 'react';
import Link from 'next/link';
import { Milk, Plus } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  FilterDate,
  FilterSelect,
  FormDialog,
  Muted,
  Pagination,
  PrimaryCell,
  SearchInput,
  StatusBadge,
  inputClass,
  primaryButton,
  type Column,
} from '@/components/admin';
import { ToastProvider, useToast } from '@/app/superadmin/_components/toast';
import { SyncPill } from '@/components/offline/status';
import type { Collection } from '@/app/superadmin/_types/platform-types';
import { formatDate, formatLitres, formatNumber, formatPercent, isoDay } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { listCollections, recordCollection, recordingOptions, type CollectionInput } from '../_api/collection-client';

const SUBTITLE: Record<string, string> = {
  COOP_ADMIN: "Every delivery recorded in your cooperative.",
  MANAGER: "Every delivery recorded in your cooperative.",
  COLLECTOR: 'The milk you have collected.',
  FARMER: 'Your milk deliveries and their quality results.',
};

export function CollectionsWorkspace() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

function Workspace() {
  const toast = useToast();
  const list = useListState({ filters: { quality_status: '', date_from: '', date_to: '' } });
  const data = useResource(() => listCollections(list.params), [JSON.stringify(list.params)]);
  useReloadOn(['collections'], data.reload);
  const [recording, setRecording] = useState(false);
  const role = data.data?.role ?? '';
  const s = data.data?.summary;
  const isFarmer = role === 'FARMER';

  const columns: Column<Collection>[] = [
    { key: 'date', header: 'Date', sortKey: 'collection_date', cell: (c) => <PrimaryCell title={formatDate(c.collection_date)} subtitle={c.collection_time ?? undefined} /> },
    {
      key: 'ref',
      header: 'Reference',
      cell: (c) =>
        c.sync_status && c.sync_status !== 'synced' ? (
          <SyncPill status={c.sync_status} error={c.sync_error} />
        ) : (
          <span className="font-mono text-xs">{c.reference}</span>
        ),
    },
    { key: 'farmer', header: 'Farmer', hidden: isFarmer, cell: (c) => <PrimaryCell title={c.farmer_name} subtitle={c.farmer_number} /> },
    { key: 'collector', header: 'Collector', hidden: role === 'COLLECTOR', cell: (c) => c.collector_name ?? <Muted>Staff</Muted> },
    { key: 'cooler', header: 'Cooler', cell: (c) => c.cooler_name ?? <Muted /> },
    { key: 'qty', header: 'Litres', sortKey: 'quantity_litres', align: 'right', cell: (c) => formatLitres(c.quantity_litres) },
    { key: 'fat', header: 'Fat', align: 'right', cell: (c) => formatPercent(c.fat_percentage) },
    {
      key: 'quality',
      header: 'Quality',
      cell: (c) => (
        <span title={c.rejection_reason ?? undefined}>
          <StatusBadge status={c.quality_status} />
        </span>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-[#F6F7F4] px-4 py-8 text-[#17221D] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {role === 'COOP_ADMIN' || role === 'MANAGER' ? (
              <Link href="/cooperatives" className="text-sm font-medium text-[#176044] hover:underline">← Cooperative workspace</Link>
            ) : (
              <p className="text-xs font-semibold uppercase tracking-widest text-[#5E6B64]">Milkflow</p>
            )}
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Milk collections</h1>
            <p className="mt-1 text-[#5E6B64]">{SUBTITLE[role] ?? 'Milk intake records.'}</p>
            {data.data?.offline && <p className="mt-1 text-xs text-[#8A968F]">Showing collections saved on this device (recent history kept for offline use).</p>}
          </div>
          {data.data?.can_record && (
            <button onClick={() => setRecording(true)} className={primaryButton}>
              <Plus className="size-4" /> Record collection
            </button>
          )}
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Collections', s ? formatNumber(s.collections) : '–'],
            ['Accepted milk', s ? formatLitres(s.accepted_litres) : '–'],
            ['Rejected', s ? formatLitres(s.rejected_litres) : '–'],
            ['Average fat', s ? formatPercent(s.average_fat_percentage) : '–'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-[#DDE3DE] bg-white px-4 py-3">
              <dt className="text-xs text-[#5E6B64]">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <DataTable
          columns={columns}
          rows={data.data?.items}
          rowKey={(c) => c.id}
          loading={data.loading}
          error={data.error}
          onRetry={data.reload}
          sort={list.sort}
          onSort={list.setSort}
          minWidth="680px"
          toolbar={
            <FilterBar onReset={list.reset} filtered={list.isFiltered}>
              <SearchInput value={list.search} onChange={list.setSearch} placeholder={isFarmer ? 'Search reference' : 'Search reference, farmer name or number'} label="Search collections" />
              <FilterSelect label="Quality" value={list.filters.quality_status} onChange={(v) => list.setFilter('quality_status', v)} allLabel="Any quality" options={[{ value: 'ACCEPTED', label: 'Accepted' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'PENDING', label: 'Pending lab' }]} />
              <FilterDate label="From" value={list.filters.date_from} onChange={(v) => list.setFilter('date_from', v)} />
              <FilterDate label="To" value={list.filters.date_to} onChange={(v) => list.setFilter('date_to', v)} />
            </FilterBar>
          }
          empty={<EmptyState icon={<Milk className="size-8" />} title={list.isFiltered ? 'No collections match' : 'No collections yet'} body={data.data?.can_record && !list.isFiltered ? 'Record the first delivery with “Record collection”.' : undefined} />}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
        />
      </div>

      {recording && (
        <RecordForm
          showCollector={role === 'COOP_ADMIN' || role === 'MANAGER'}
          onClose={() => setRecording(false)}
          onSaved={(c) => {
            setRecording(false);
            const pending = c.sync_status && c.sync_status !== 'synced';
            toast(`${formatLitres(c.quantity_litres)} from ${c.farmer_name} recorded${c.quality_status === 'REJECTED' ? ' as rejected' : ''}${pending ? ' · Pending synchronization' : '.'}`);
            void data.reload();
          }}
        />
      )}
    </main>
  );
}

function RecordForm({ showCollector, onClose, onSaved }: { showCollector: boolean; onClose: () => void; onSaved: (c: Collection) => void }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [farmerSearch, setFarmerSearch] = useState('');
  const debounced = useDebounced(farmerSearch);
  const options = useResource(() => recordingOptions(debounced), [debounced]);
  const [f, setF] = useState({
    farmer_id: '',
    collector_id: '',
    cooler_id: '',
    collection_date: isoDay(),
    quantity_litres: '',
    fat_percentage: '',
    snf_percentage: '',
    temperature_c: '',
    quality_status: '',
    rejection_reason: '',
    notes: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  // A collector's own cooler is preselected until they choose another (or none).
  const [coolerTouched, setCoolerTouched] = useState(false);
  const coolerId = coolerTouched ? f.cooler_id : f.cooler_id || options.data?.default_cooler_id || '';

  async function submit() {
    let saved: Collection | undefined;
    const body: CollectionInput = {
      farmer_id: f.farmer_id,
      collector_id: showCollector ? f.collector_id || null : undefined,
      cooler_id: coolerId || null,
      collection_date: f.collection_date,
      quantity_litres: Number(f.quantity_litres),
      fat_percentage: num(f.fat_percentage),
      snf_percentage: num(f.snf_percentage),
      temperature_c: num(f.temperature_c),
      notes: f.notes || null,
      ...(f.quality_status ? { quality_status: f.quality_status as CollectionInput['quality_status'], rejection_reason: f.rejection_reason || null } : {}),
    };
    const ok = await run(async () => {
      saved = await recordCollection(body);
    });
    if (ok && saved) onSaved(saved);
  }

  return (
    <FormDialog title="Record milk collection" onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel="Record collection" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Find farmer" hint="Type a name or farmer number">
          {(p) => <input {...p} className={inputClass} value={farmerSearch} onChange={(e) => setFarmerSearch(e.target.value)} autoFocus />}
        </Field>
        <Field label="Farmer" required error={fieldErrors.farmer_id}>
          {(p) => (
            <select {...p} className={inputClass} value={f.farmer_id} onChange={set('farmer_id')}>
              <option value="">{options.loading ? 'Loading…' : 'Choose a farmer'}</option>
              {(options.data?.farmers ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Litres" required error={fieldErrors.quantity_litres}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.quantity_litres} onChange={set('quantity_litres')} />}
        </Field>
        <Field label="Date" required error={fieldErrors.collection_date}>
          {(p) => <input {...p} type="date" max={isoDay()} className={inputClass} value={f.collection_date} onChange={set('collection_date')} />}
        </Field>
        <Field label="Cooler" error={fieldErrors.cooler_id}>
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={coolerId}
              onChange={(e) => {
                setCoolerTouched(true);
                setF({ ...f, cooler_id: e.target.value });
              }}
            >
              <option value="">None</option>
              {(options.data?.coolers ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}{x.is_operational ? '' : ' (offline)'}</option>)}
            </select>
          )}
        </Field>
        {showCollector && (
          <Field label="Collected by" error={fieldErrors.collector_id}>
            {(p) => (
              <select {...p} className={inputClass} value={f.collector_id} onChange={set('collector_id')}>
                <option value="">Cooperative staff (me)</option>
                {(options.data?.collectors ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Butterfat %" error={fieldErrors.fat_percentage}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.fat_percentage} onChange={set('fat_percentage')} />}
        </Field>
        <Field label="SNF %" error={fieldErrors.snf_percentage}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.snf_percentage} onChange={set('snf_percentage')} />}
        </Field>
        <Field label="Temperature °C" error={fieldErrors.temperature_c}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.temperature_c} onChange={set('temperature_c')} />}
        </Field>
        <Field label="Quality" error={fieldErrors.quality_status} hint="Automatic uses the platform's temperature and fat limits.">
          {(p) => (
            <select {...p} className={inputClass} value={f.quality_status} onChange={set('quality_status')}>
              <option value="">Automatic</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED">Rejected</option>
              <option value="PENDING">Pending lab test</option>
            </select>
          )}
        </Field>
        {f.quality_status === 'REJECTED' && (
          <Field label="Why was it rejected?" required error={fieldErrors.rejection_reason}>
            {(p) => <input {...p} className={inputClass} value={f.rejection_reason} onChange={set('rejection_reason')} />}
          </Field>
        )}
      </div>
      <Field label="Notes" error={fieldErrors.notes}>
        {(p) => <textarea {...p} rows={2} className={inputClass} value={f.notes} onChange={set('notes')} />}
      </Field>
    </FormDialog>
  );
}
