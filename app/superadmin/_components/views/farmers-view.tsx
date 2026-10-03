'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  DetailList,
  DetailPanel,
  DetailRow,
  DetailSection,
  EmptyState,
  ErrorBanner,
  Field,
  FilterBar,
  FilterSelect,
  FormDialog,
  LoadingState,
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
import { createFarmer, getFarmer, listFarmers, setFarmerStatus, updateFarmer } from '../../_api/superadmin-client';
import type { Farmer, FarmerInput } from '../../_types/platform-types';
import { useToast } from '../toast';
import { ACTIVE_OPTIONS, AuditTrail, useCooperativeOptions, useFocusParam } from './common';

export function FarmersView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const toast = useToast();
  const list = useListState({ filters: { cooperative_id: cooperativeId ?? '', status: '' } });
  const data = useResource(() => listFarmers(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [focus, setFocus] = useFocusParam();
  const [editing, setEditing] = useState<Farmer | 'new' | null>(null);

  const columns: Column<Farmer>[] = [
    { key: 'name', header: 'Farmer', sortKey: 'name', cell: (f) => <PrimaryCell title={f.full_name} subtitle={f.farmer_number} /> },
    { key: 'coop', header: 'Cooperative', sortKey: 'cooperative', hidden: !!cooperativeId, cell: (f) => f.cooperative_name },
    { key: 'phone', header: 'Phone', cell: (f) => <span className="whitespace-nowrap tabular-nums">{formatPhone(f.phone)}</span> },
    { key: 'village', header: 'Farm location', cell: (f) => f.village ?? <Muted /> },
    { key: 'cows', header: 'Cows', align: 'right', cell: (f) => (f.number_of_cows == null ? <Muted /> : formatNumber(f.number_of_cows)) },
    { key: 'litres', header: 'Total milk', align: 'right', cell: (f) => formatLitres(f.stats.total_litres) },
    { key: 'last', header: 'Last delivery', cell: (f) => (f.stats.last_collection ? formatDate(f.stats.last_collection) : <Muted>None</Muted>) },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (f) => <StatusBadge status={f.status} /> },
  ];

  return (
    <>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Farmers</h1>
            <p className="mt-1 text-[#5E6B64]">Every farmer delivering milk to a cooperative on the platform.</p>
          </div>
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" /> New farmer
          </button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(f) => f.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        sort={list.sort}
        onSort={list.setSort}
        onRowClick={(f) => setFocus(f.id)}
        rowClassName={(f) => (f.status === 'INACTIVE' ? 'text-[#8A968F]' : '')}
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, phone, farmer number, ID or village" label="Search farmers" />
            {!cooperativeId && <FilterSelect label="Cooperative" value={list.filters.cooperative_id} onChange={(v) => list.setFilter('cooperative_id', v)} allLabel="All cooperatives" options={coops} />}
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="Any status" options={ACTIVE_OPTIONS} />
            {embedded && (
              <button onClick={() => setEditing('new')} className={`${secondaryButton} ml-auto`}>
                <Plus className="size-4" /> Add farmer
              </button>
            )}
          </FilterBar>
        }
        empty={<EmptyState icon={<Users className="size-8" />} title={list.isFiltered ? 'No farmers match' : 'No farmers yet'} body={list.isFiltered ? 'Try a different search or clear the filters.' : 'Farmers registered by cooperatives appear here.'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {focus && <FarmerPanel id={focus} onClose={() => setFocus(null)} onEdit={setEditing} onChanged={() => void data.reload()} />}
      {editing && (
        <FarmerForm
          farmer={editing === 'new' ? null : editing}
          cooperativeId={cooperativeId}
          onClose={() => setEditing(null)}
          onSaved={(f, created) => {
            setEditing(null);
            toast(`${f.full_name} ${created ? 'added' : 'updated'}.`);
            void data.reload();
            setFocus(f.id);
          }}
        />
      )}
    </>
  );
}

function FarmerPanel({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (f: Farmer) => void; onChanged: () => void }) {
  const toast = useToast();
  const farmer = useResource(() => getFarmer(id), [id]);
  const [confirming, setConfirming] = useState(false);
  const f = farmer.data;

  return (
    <DetailPanel
      title={f?.full_name ?? 'Farmer'}
      subtitle={f && `${f.farmer_number} · ${f.cooperative_name}`}
      badge={f && <StatusBadge status={f.status} />}
      onClose={onClose}
      actions={
        f && (
          <>
            <button onClick={() => setConfirming(true)} className={f.status === 'ACTIVE' ? dangerButton : secondaryButton}>
              {f.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </button>
            <button onClick={() => onEdit(f)} className={primaryButton}>Edit</button>
          </>
        )
      }
    >
      {farmer.error && <ErrorBanner message={farmer.error} onRetry={farmer.reload} />}
      {!f && !farmer.error && <LoadingState rows={4} />}
      {f && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Total milk', formatLitres(f.stats.total_litres)],
              ['Deliveries', formatNumber(f.stats.collections)],
              ['Last delivery', f.stats.last_collection ? formatDate(f.stats.last_collection) : '–'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[#EEF1EC] px-3 py-2">
                <p className="text-xs text-[#5E6B64]">{label}</p>
                <p className="font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <DetailSection title="Profile">
            <DetailList>
              <DetailRow label="Cooperative" value={<Link className="text-[#176044] hover:underline" href={`/superadmin/cooperatives/${f.cooperative_id}`}>{f.cooperative_name}</Link>} />
              <DetailRow label="Phone" value={formatPhone(f.phone)} />
              <DetailRow label="National ID" value={f.national_id} />
              <DetailRow label="Farm location" value={f.village} />
              <DetailRow label="Cows" value={f.number_of_cows ?? '–'} />
              <DetailRow label="Collection centre" value={f.centre_name ?? 'Not assigned'} />
              <DetailRow label="App account" value={f.has_account ? 'Yes, can sign in' : 'No'} />
              <DetailRow label="Registered" value={formatDate(f.created_at)} />
            </DetailList>
          </DetailSection>
          <DetailSection title="Payment details">
            <DetailList>
              <DetailRow label="Method" value={f.payment_method === 'MPESA' ? 'M-Pesa' : f.payment_method === 'BANK' ? 'Bank' : 'Not set'} />
              {f.payment_method && <DetailRow label="Account" value={f.payment_method === 'MPESA' ? formatPhone(f.payment_account) : f.payment_account} />}
              {f.payment_method === 'BANK' && <DetailRow label="Bank" value={f.bank_name} />}
            </DetailList>
            {!f.payments_supported && <p className="mt-2 text-xs text-[#8A968F]">Milk payouts to farmers are not tracked by the platform yet.</p>}
          </DetailSection>
          <DetailSection title="Recent collections" action={<Link href={`/superadmin/collections?farmer_id=${f.id}`} className="text-xs font-medium text-[#176044] hover:underline">All collections</Link>}>
            {f.recent_collections.length === 0 ? (
              <p className="text-sm text-[#5E6B64]">No milk recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[#EEF1EC] rounded-lg border border-[#EEF1EC] text-sm">
                {f.recent_collections.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      {formatDate(c.collection_date)} <span className="text-[#8A968F]">{c.collection_time}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatLitres(c.quantity_litres)}</span>
                      <StatusBadge status={c.quality_status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
          <DetailSection title="Activity">
            <AuditTrail entries={f.activity} />
          </DetailSection>
        </>
      )}
      {f && confirming && (
        <ConfirmationDialog
          title={f.status === 'ACTIVE' ? `Deactivate ${f.full_name}?` : `Reactivate ${f.full_name}?`}
          body={f.status === 'ACTIVE' ? 'No new milk can be recorded for them. Their history stays.' : 'Milk can be recorded for them again.'}
          confirmLabel={f.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
          danger={f.status === 'ACTIVE'}
          reason={{ label: 'Reason' }}
          onClose={() => setConfirming(false)}
          onConfirm={async (reason) => {
            await setFarmerStatus(f.id, f.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason || undefined);
            setConfirming(false);
            toast(`${f.full_name} ${f.status === 'ACTIVE' ? 'deactivated' : 'reactivated'}.`);
            await farmer.reload();
            onChanged();
          }}
        />
      )}
    </DetailPanel>
  );
}

function FarmerForm({
  farmer,
  cooperativeId,
  onClose,
  onSaved,
}: {
  farmer: Farmer | null;
  cooperativeId?: string;
  onClose: () => void;
  onSaved: (f: Farmer, created: boolean) => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const coops = useCooperativeOptions(!cooperativeId && !farmer);
  const [f, setF] = useState({
    cooperative_id: farmer?.cooperative_id ?? cooperativeId ?? '',
    first_name: farmer?.first_name ?? '',
    last_name: farmer?.last_name ?? '',
    phone: farmer ? formatPhone(farmer.phone) : '',
    national_id: farmer?.national_id ?? '',
    village: farmer?.village ?? '',
    number_of_cows: farmer?.number_of_cows?.toString() ?? '',
    payment_method: farmer?.payment_method ?? '',
    payment_account: farmer?.payment_method === 'MPESA' ? formatPhone(farmer.payment_account) : farmer?.payment_account ?? '',
    bank_name: farmer?.bank_name ?? '',
    farmer_number: farmer?.farmer_number ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    let saved: Farmer | undefined;
    const body: FarmerInput = {
      first_name: f.first_name,
      last_name: f.last_name,
      phone: f.phone,
      national_id: f.national_id || null,
      village: f.village || null,
      number_of_cows: f.number_of_cows ? Number(f.number_of_cows) : null,
      payment_method: (f.payment_method || null) as FarmerInput['payment_method'],
      payment_account: f.payment_account || null,
      bank_name: f.payment_method === 'BANK' ? f.bank_name || null : null,
    };
    if (f.farmer_number.trim()) body.farmer_number = f.farmer_number;
    const ok = await run(async () => {
      saved = farmer ? await updateFarmer(farmer.id, body) : await createFarmer({ ...body, cooperative_id: f.cooperative_id });
    });
    if (ok && saved) onSaved(saved, !farmer);
  }

  return (
    <FormDialog title={farmer ? `Edit ${farmer.full_name}` : 'New farmer'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel={farmer ? 'Save changes' : 'Add farmer'} wide>
      {!farmer && !cooperativeId && (
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
        <Field label="First name" required error={fieldErrors.first_name}>
          {(p) => <input {...p} className={inputClass} value={f.first_name} onChange={set('first_name')} autoFocus />}
        </Field>
        <Field label="Last name" required error={fieldErrors.last_name}>
          {(p) => <input {...p} className={inputClass} value={f.last_name} onChange={set('last_name')} />}
        </Field>
        <Field label="Phone" required error={fieldErrors.phone}>
          {(p) => <input {...p} type="tel" className={inputClass} value={f.phone} onChange={set('phone')} placeholder="0712 345 678" />}
        </Field>
        <Field label="National ID" error={fieldErrors.national_id} hint="7 or 8 digits. Optional.">
          {(p) => <input {...p} inputMode="numeric" className={inputClass} value={f.national_id} onChange={set('national_id')} maxLength={8} />}
        </Field>
        <Field label="Farm location / village" error={fieldErrors.village}>
          {(p) => <input {...p} className={inputClass} value={f.village} onChange={set('village')} />}
        </Field>
        <Field label="Number of cows" error={fieldErrors.number_of_cows}>
          {(p) => <input {...p} inputMode="numeric" className={inputClass} value={f.number_of_cows} onChange={set('number_of_cows')} />}
        </Field>
        <Field label="Paid by" error={fieldErrors.payment_method}>
          {(p) => (
            <select {...p} className={inputClass} value={f.payment_method} onChange={set('payment_method')}>
              <option value="">Not set</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank transfer</option>
            </select>
          )}
        </Field>
        {f.payment_method && (
          <Field
            label={f.payment_method === 'MPESA' ? 'M-Pesa number' : 'Account number'}
            error={fieldErrors.payment_account}
            hint={f.payment_method === 'MPESA' ? "Leave blank to use the farmer's phone." : undefined}
          >
            {(p) => <input {...p} className={inputClass} value={f.payment_account} onChange={set('payment_account')} />}
          </Field>
        )}
        {f.payment_method === 'BANK' && (
          <Field label="Bank" required error={fieldErrors.bank_name}>
            {(p) => <input {...p} className={inputClass} value={f.bank_name} onChange={set('bank_name')} />}
          </Field>
        )}
        <Field label="Farmer number" error={fieldErrors.farmer_number} hint={farmer ? undefined : 'Blank = next number (F-0001).'}>
          {(p) => <input {...p} className={inputClass} value={f.farmer_number} onChange={set('farmer_number')} />}
        </Field>
      </div>
    </FormDialog>
  );
}
