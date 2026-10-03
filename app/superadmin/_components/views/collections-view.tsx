'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Milk } from 'lucide-react';
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
  StatusBadge,
  inputClass,
  type Column,
} from '@/components/admin';
import { formatDate, formatDateTime, formatLitres, formatNumber, formatPercent } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { getCollection, listCollections, listCollectors, listCoolers } from '../../_api/superadmin-client';
import type { Collection } from '../../_types/platform-types';
import { useCooperativeOptions, useFocusParam, useFocusedRecord } from './common';

export function CollectionsView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const params = useSearchParams();
  const list = useListState({
    filters: {
      cooperative_id: cooperativeId ?? '',
      farmer_id: params.get('farmer_id') ?? '',
      collector_id: '',
      cooler_id: '',
      quality_status: '',
      date_from: '',
      date_to: '',
      min_litres: '',
      max_litres: '',
    },
  });
  const data = useResource(() => listCollections(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const coop = list.filters.cooperative_id;
  // Collector and cooler filters only make sense inside one cooperative.
  const collectors = useResource(() => (coop ? listCollectors({ cooperative_id: coop, page_size: 100 }) : Promise.resolve(null)), [coop]);
  const coolers = useResource(() => (coop ? listCoolers({ cooperative_id: coop, page_size: 100 }) : Promise.resolve(null)), [coop]);
  const [focus, setFocus] = useFocusParam();
  const focused = useFocusedRecord(focus, data.data?.items, getCollection);
  const s = data.data?.summary;

  const columns: Column<Collection>[] = useMemo(
    () => [
      { key: 'ref', header: 'Reference', cell: (c) => <PrimaryCell title={<span className="font-mono text-xs">{c.reference}</span>} subtitle={`${formatDate(c.collection_date)} ${c.collection_time ?? ''}`} /> },
      { key: 'coop', header: 'Cooperative', sortKey: 'cooperative', hidden: !!cooperativeId, cell: (c) => c.cooperative_name },
      { key: 'farmer', header: 'Farmer', sortKey: 'farmer', cell: (c) => <PrimaryCell title={c.farmer_name} subtitle={c.farmer_number} /> },
      { key: 'collector', header: 'Collector', cell: (c) => c.collector_name ?? <Muted>Staff</Muted> },
      { key: 'cooler', header: 'Cooler', cell: (c) => c.cooler_name ?? <Muted /> },
      { key: 'qty', header: 'Litres', sortKey: 'quantity_litres', align: 'right', cell: (c) => formatLitres(c.quantity_litres) },
      { key: 'fat', header: 'Fat', sortKey: 'fat_percentage', align: 'right', cell: (c) => formatPercent(c.fat_percentage) },
      { key: 'quality', header: 'Quality', cell: (c) => <StatusBadge status={c.quality_status} /> },
    ],
    [cooperativeId],
  );

  return (
    <>
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Milk collections</h1>
          <p className="mt-1 text-[#5E6B64]">Every delivery recorded on the platform, linked to its cooperative, farmer, collector and cooler.</p>
        </div>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Collections', s ? formatNumber(s.collections) : '–'],
          ['Accepted milk', s ? formatLitres(s.accepted_litres) : '–'],
          ['Rejected', s ? `${formatNumber(s.rejected_collections)} · ${formatLitres(s.rejected_litres)}` : '–'],
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
        onRowClick={(c) => setFocus(c.id)}
        toolbar={
          <div className="space-y-3">
            <FilterBar onReset={list.reset} filtered={list.isFiltered}>
              <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search MC- reference, farmer name or number" label="Search collections" />
              {!cooperativeId && (
                <FilterSelect
                  label="Cooperative"
                  value={coop}
                  onChange={(v) => {
                    list.setFilter('cooperative_id', v);
                    list.setFilter('collector_id', '');
                    list.setFilter('cooler_id', '');
                  }}
                  allLabel="All cooperatives"
                  options={coops}
                />
              )}
              <FilterSelect label="Quality" value={list.filters.quality_status} onChange={(v) => list.setFilter('quality_status', v)} allLabel="Any quality" options={[{ value: 'ACCEPTED', label: 'Accepted' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'PENDING', label: 'Pending lab' }]} />
            </FilterBar>
            <div className="flex flex-wrap items-center gap-3">
              <FilterDate label="From" value={list.filters.date_from} onChange={(v) => list.setFilter('date_from', v)} />
              <FilterDate label="To" value={list.filters.date_to} onChange={(v) => list.setFilter('date_to', v)} />
              <label className="flex items-center gap-2 text-sm text-[#5E6B64]">
                Litres
                <input aria-label="Minimum litres" inputMode="decimal" placeholder="min" value={list.filters.min_litres} onChange={(e) => list.setFilter('min_litres', e.target.value)} className={`${inputClass} w-20`} />
                –
                <input aria-label="Maximum litres" inputMode="decimal" placeholder="max" value={list.filters.max_litres} onChange={(e) => list.setFilter('max_litres', e.target.value)} className={`${inputClass} w-20`} />
              </label>
              {coop && (
                <>
                  <FilterSelect label="Collector" value={list.filters.collector_id} onChange={(v) => list.setFilter('collector_id', v)} allLabel="All collectors" options={(collectors.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.full_name} (${c.collector_number})` }))} />
                  <FilterSelect label="Cooler" value={list.filters.cooler_id} onChange={(v) => list.setFilter('cooler_id', v)} allLabel="All coolers" options={(coolers.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
                </>
              )}
              {list.filters.farmer_id && (
                <button onClick={() => list.setFilter('farmer_id', '')} className="rounded-full bg-[#E3F1E9] px-2.5 py-1 text-xs font-medium text-[#176044]">
                  One farmer only ✕
                </button>
              )}
            </div>
          </div>
        }
        empty={<EmptyState icon={<Milk className="size-8" />} title={list.isFiltered ? 'No collections match' : 'No milk recorded yet'} body={list.isFiltered ? 'Try a wider date range or clear the filters.' : 'Collections recorded by cooperatives and collectors appear here.'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {focus && focused && (
        <DetailPanel title={focused.reference} subtitle={`${formatDate(focused.collection_date)} at ${focused.collection_time ?? ''}`} badge={<StatusBadge status={focused.quality_status} />} onClose={() => setFocus(null)}>
          <DetailSection title="Delivery">
            <DetailList>
              <DetailRow label="Quantity" value={formatLitres(focused.quantity_litres)} />
              <DetailRow label="Butterfat" value={formatPercent(focused.fat_percentage)} />
              <DetailRow label="SNF" value={formatPercent(focused.snf_percentage)} />
              <DetailRow label="Temperature" value={focused.temperature_c != null ? `${focused.temperature_c} °C` : '–'} />
              {focused.rejection_reason && <DetailRow label="Rejected because" value={focused.rejection_reason} />}
              {focused.notes && <DetailRow label="Notes" value={focused.notes} />}
            </DetailList>
          </DetailSection>
          <DetailSection title="Linked records">
            <DetailList>
              <DetailRow label="Cooperative" value={<Link className="text-[#176044] hover:underline" href={`/superadmin/cooperatives/${focused.cooperative_id}`}>{focused.cooperative_name}</Link>} />
              <DetailRow label="Farmer" value={<Link className="text-[#176044] hover:underline" href={`/superadmin/farmers?focus=${focused.farmer_id}`}>{focused.farmer_name} ({focused.farmer_number})</Link>} />
              <DetailRow label="Collector" value={focused.collector_id ? <Link className="text-[#176044] hover:underline" href={`/superadmin/collectors?focus=${focused.collector_id}`}>{focused.collector_name} ({focused.collector_number})</Link> : 'Recorded by cooperative staff'} />
              <DetailRow label="Cooler" value={focused.cooler_id ? <Link className="text-[#176044] hover:underline" href={`/superadmin/coolers?focus=${focused.cooler_id}`}>{focused.cooler_name} ({focused.cooler_code})</Link> : '–'} />
              <DetailRow label="Recorded" value={formatDateTime(focused.created_at)} />
            </DetailList>
          </DetailSection>
          <Link href={`/superadmin/audit?entity_type=collection&entity_id=${focused.id}`} className="text-sm font-medium text-[#176044] hover:underline">
            View the audit trail for this collection
          </Link>
        </DetailPanel>
      )}
    </>
  );
}
