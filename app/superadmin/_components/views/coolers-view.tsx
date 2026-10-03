'use client';

import { useState } from 'react';
import { Plus, Snowflake } from 'lucide-react';
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
import { formatDateTime, formatLitres, formatNumber } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { createCooler, getCooler, listCoolers, setCoolerStatus, updateCooler } from '../../_api/superadmin-client';
import type { Cooler } from '../../_types/platform-types';
import { useToast } from '../toast';
import { ACTIVE_OPTIONS, useCooperativeOptions, useFocusParam, useFocusedRecord } from './common';

function OperationalBadge({ cooler }: { cooler: Cooler }) {
  if (cooler.status === 'INACTIVE') return <StatusBadge status="INACTIVE" label="Decommissioned" />;
  return cooler.is_operational ? <StatusBadge status="ONLINE" label="Operational" /> : <StatusBadge status="OFFLINE" label="Offline" />;
}

export function CoolersView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const toast = useToast();
  const list = useListState({ filters: { cooperative_id: cooperativeId ?? '', status: '', operational: '' } });
  const data = useResource(() => listCoolers(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [focus, setFocus] = useFocusParam();
  const [editing, setEditing] = useState<Cooler | 'new' | null>(null);
  const [toggling, setToggling] = useState<Cooler | null>(null);
  const focused = useFocusedRecord(focus, data.data?.items, getCooler);

  async function setOperational(cooler: Cooler, value: boolean) {
    try {
      await updateCooler(cooler.id, { is_operational: value });
      toast(`${cooler.name} marked ${value ? 'operational' : 'offline'}.`);
      await data.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the cooler.', 'error');
    }
  }

  const columns: Column<Cooler>[] = [
    { key: 'name', header: 'Cooler', sortKey: 'name', cell: (c) => <PrimaryCell title={c.name} subtitle={c.code} /> },
    { key: 'coop', header: 'Cooperative', sortKey: 'cooperative', hidden: !!cooperativeId, cell: (c) => c.cooperative_name },
    { key: 'location', header: 'Location', cell: (c) => c.location ?? c.centre_name ?? <Muted /> },
    { key: 'capacity', header: 'Capacity', sortKey: 'capacity_litres', align: 'right', cell: (c) => (c.capacity_litres ? formatLitres(c.capacity_litres) : <Muted />) },
    { key: 'today', header: 'Received today', align: 'right', cell: (c) => formatLitres(c.litres_today) },
    { key: 'device', header: 'Scale / device', cell: (c) => (c.scale_device_id ? <code className="text-xs">{c.scale_device_id}</code> : <Muted />) },
    { key: 'state', header: 'State', cell: (c) => <OperationalBadge cooler={c} /> },
  ];

  return (
    <>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Coolers</h1>
            <p className="mt-1 text-[#5E6B64]">Bulk milk coolers and scales across every cooperative.</p>
          </div>
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" /> New cooler
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
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, code, location or device ID" label="Search coolers" />
            {!cooperativeId && <FilterSelect label="Cooperative" value={list.filters.cooperative_id} onChange={(v) => list.setFilter('cooperative_id', v)} allLabel="All cooperatives" options={coops} />}
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="Any status" options={ACTIVE_OPTIONS} />
            <FilterSelect label="Operational" value={list.filters.operational} onChange={(v) => list.setFilter('operational', v)} allLabel="Online or offline" options={[{ value: 'true', label: 'Operational' }, { value: 'false', label: 'Offline' }]} />
            {embedded && (
              <button onClick={() => setEditing('new')} className={`${secondaryButton} ml-auto`}>
                <Plus className="size-4" /> Add cooler
              </button>
            )}
          </FilterBar>
        }
        empty={<EmptyState icon={<Snowflake className="size-8" />} title={list.isFiltered ? 'No coolers match' : 'No coolers yet'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {focus && focused && (
        <DetailPanel
          title={focused.name}
          subtitle={`${focused.code} · ${focused.cooperative_name ?? ''}`}
          badge={<OperationalBadge cooler={focused} />}
          onClose={() => setFocus(null)}
          actions={
            <>
              <button onClick={() => setToggling(focused)} className={focused.status === 'ACTIVE' ? dangerButton : secondaryButton}>
                {focused.status === 'ACTIVE' ? 'Decommission' : 'Return to service'}
              </button>
              {focused.status === 'ACTIVE' && (
                <button onClick={() => setOperational(focused, !focused.is_operational)} className={secondaryButton}>
                  Mark {focused.is_operational ? 'offline' : 'operational'}
                </button>
              )}
              <button onClick={() => setEditing(focused)} className={primaryButton}>Edit</button>
            </>
          }
        >
          <DetailSection title="Equipment">
            <DetailList>
              <DetailRow label="Capacity" value={focused.capacity_litres ? formatLitres(focused.capacity_litres) : 'Not set'} />
              <DetailRow label="Scale / device ID" value={focused.scale_device_id ?? 'None'} />
              <DetailRow label="Location" value={focused.location ?? 'Not set'} />
              <DetailRow label="Collection centre" value={focused.centre_name ?? 'Not linked'} />
            </DetailList>
          </DetailSection>
          <DetailSection title="Current operation">
            <DetailList>
              <DetailRow label="Milk received today" value={formatLitres(focused.litres_today)} />
              <DetailRow
                label="Fill level"
                value={focused.capacity_litres ? `${formatNumber(Math.round((focused.litres_today / focused.capacity_litres) * 100))}% of capacity (from today's collections)` : '–'}
              />
              <DetailRow label="Last temperature" value={focused.last_temperature_c != null ? `${focused.last_temperature_c} °C at ${formatDateTime(focused.last_reading_at)}` : 'No reading yet'} />
            </DetailList>
          </DetailSection>
        </DetailPanel>
      )}
      {toggling && (
        <ConfirmationDialog
          title={toggling.status === 'ACTIVE' ? `Decommission ${toggling.name}?` : `Return ${toggling.name} to service?`}
          body={toggling.status === 'ACTIVE' ? 'No new milk can be recorded into it. Its history stays.' : 'Milk can be recorded into it again.'}
          confirmLabel={toggling.status === 'ACTIVE' ? 'Decommission' : 'Return to service'}
          danger={toggling.status === 'ACTIVE'}
          reason={{ label: 'Reason' }}
          onClose={() => setToggling(null)}
          onConfirm={async (reason) => {
            await setCoolerStatus(toggling.id, toggling.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason || undefined);
            toast(`${toggling.name} ${toggling.status === 'ACTIVE' ? 'decommissioned' : 'returned to service'}.`);
            setToggling(null);
            await data.reload();
          }}
        />
      )}
      {editing && (
        <CoolerForm
          cooler={editing === 'new' ? null : editing}
          cooperativeId={cooperativeId}
          onClose={() => setEditing(null)}
          onSaved={(c, created) => {
            setEditing(null);
            toast(`${c.name} ${created ? 'added' : 'updated'}.`);
            void data.reload();
            setFocus(c.id);
          }}
        />
      )}
    </>
  );
}

function CoolerForm({ cooler, cooperativeId, onClose, onSaved }: { cooler: Cooler | null; cooperativeId?: string; onClose: () => void; onSaved: (c: Cooler, created: boolean) => void }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const coops = useCooperativeOptions(!cooperativeId && !cooler);
  const [f, setF] = useState({
    cooperative_id: cooler?.cooperative_id ?? cooperativeId ?? '',
    name: cooler?.name ?? '',
    code: cooler?.code ?? '',
    location: cooler?.location ?? '',
    capacity_litres: cooler?.capacity_litres?.toString() ?? '',
    scale_device_id: cooler?.scale_device_id ?? '',
    is_operational: cooler?.is_operational ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    let saved: Cooler | undefined;
    const body = {
      name: f.name,
      location: f.location || null,
      capacity_litres: f.capacity_litres ? Number(f.capacity_litres) : null,
      scale_device_id: f.scale_device_id || null,
      is_operational: f.is_operational,
      ...(f.code.trim() ? { code: f.code } : {}),
    };
    const ok = await run(async () => {
      saved = cooler ? await updateCooler(cooler.id, body) : await createCooler({ ...body, cooperative_id: f.cooperative_id });
    });
    if (ok && saved) onSaved(saved, !cooler);
  }

  return (
    <FormDialog title={cooler ? `Edit ${cooler.name}` : 'New cooler'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel={cooler ? 'Save changes' : 'Add cooler'}>
      {!cooler && !cooperativeId && (
        <Field label="Cooperative" required error={fieldErrors.cooperative_id}>
          {(p) => (
            <select {...p} className={inputClass} value={f.cooperative_id} onChange={set('cooperative_id')}>
              <option value="">Choose a cooperative</option>
              {coops.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={fieldErrors.name}>
          {(p) => <input {...p} className={inputClass} value={f.name} onChange={set('name')} autoFocus />}
        </Field>
        <Field label="Code" error={fieldErrors.code} hint={cooler ? undefined : 'Blank = next code (CLR-001).'}>
          {(p) => <input {...p} className={inputClass} value={f.code} onChange={set('code')} />}
        </Field>
        <Field label="Location" error={fieldErrors.location}>
          {(p) => <input {...p} className={inputClass} value={f.location} onChange={set('location')} />}
        </Field>
        <Field label="Capacity (litres)" error={fieldErrors.capacity_litres}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.capacity_litres} onChange={set('capacity_litres')} />}
        </Field>
        <Field label="Scale / device ID" error={fieldErrors.scale_device_id}>
          {(p) => <input {...p} className={inputClass} value={f.scale_device_id} onChange={set('scale_device_id')} />}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[#176044]" checked={f.is_operational} onChange={(e) => setF({ ...f, is_operational: e.target.checked })} />
        Operational (online and accepting milk)
      </label>
    </FormDialog>
  );
}
