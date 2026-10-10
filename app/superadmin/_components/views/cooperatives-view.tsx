'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  FilterSelect,
  FormDialog,
  PageHeader,
  Pagination,
  PrimaryCell,
  SearchInput,
  StatusBadge,
  inputClass,
  primaryButton,
  type Column,
} from '@/components/admin';
import { formatLitres, formatNumber } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { KENYA_COUNTIES } from '@/lib/validation';
import { createCooperative, listCooperatives, updateCooperative } from '../../_api/superadmin-client';
import type { Cooperative, CooperativeInput } from '../../_types/platform-types';
import { useToast } from '../toast';

export function CooperativesView() {
  const router = useRouter();
  const toast = useToast();
  const list = useListState({ filters: { status: '', county: '' }, sort: 'name' });
  const data = useResource(() => listCooperatives(list.params), [JSON.stringify(list.params)]);
  const [creating, setCreating] = useState(false);

  const columns: Column<Cooperative>[] = [
    { key: 'name', header: 'Cooperative', sortKey: 'name', cell: (c) => <PrimaryCell title={c.name} subtitle={`${c.code} · ${c.registration_number}`} /> },
    { key: 'county', header: 'County', sortKey: 'county', cell: (c) => <PrimaryCell title={c.county} subtitle={c.location ?? undefined} /> },
    { key: 'farmers', header: 'Farmers', align: 'right', cell: (c) => formatNumber(c.counts?.farmers) },
    { key: 'collectors', header: 'Collectors', align: 'right', cell: (c) => formatNumber(c.counts?.collectors) },
    { key: 'coolers', header: 'Coolers', align: 'right', cell: (c) => formatNumber(c.counts?.coolers) },
    { key: 'milk', header: 'Milk, 30 days', align: 'right', cell: (c) => formatLitres(c.counts?.litres_30d) },
    { key: 'sms', header: 'SMS credits', align: 'right', sortKey: 'sms_credit_balance', cell: (c) => formatNumber(c.sms_credit_balance) },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Cooperatives"
        subtitle="Every cooperative on the platform, its people, equipment and milk."
        action={
          <button onClick={() => setCreating(true)} className={primaryButton}>
            <Plus className="size-4" /> New cooperative
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(c) => c.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        sort={list.sort}
        onSort={list.setSort}
        onRowClick={(c) => router.push(`/superadmin/cooperatives/${c.id}`)}
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, code, registration number, county" label="Search cooperatives" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="All statuses" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
            <FilterSelect label="County" value={list.filters.county} onChange={(v) => list.setFilter('county', v)} allLabel="All counties" options={KENYA_COUNTIES.map((c) => ({ value: c, label: c }))} />
          </FilterBar>
        }
        empty={
          <EmptyState
            icon={<Building2 className="size-8" />}
            title={list.isFiltered ? 'No cooperatives match' : 'No cooperatives yet'}
            body={list.isFiltered ? 'Try a different search or clear the filters.' : 'Approve an application in Onboarding, or create a cooperative directly.'}
          />
        }
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />
      {creating && (
        <CooperativeForm
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            toast(`${c.name} created.`);
            router.push(`/superadmin/cooperatives/${c.id}`);
          }}
        />
      )}
    </>
  );
}

export function CooperativeForm({
  cooperative,
  onClose,
  onSaved,
}: {
  cooperative?: Cooperative;
  onClose: () => void;
  onSaved: (c: Cooperative) => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [f, setF] = useState({
    name: cooperative?.name ?? '',
    registration_number: cooperative?.registration_number ?? '',
    kra_pin: cooperative?.kra_pin ?? '',
    county: cooperative?.county ?? '',
    location: cooperative?.location ?? '',
    contact_email: cooperative?.contact_email ?? '',
    contact_phone: cooperative?.contact_phone ?? '',
    estimated_daily_liters: cooperative?.estimated_daily_liters?.toString() ?? '',
  });
  const [withAdmin, setWithAdmin] = useState(!cooperative);
  const [admin, setAdmin] = useState({ full_name: '', email: '', phone: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const setA = (k: keyof typeof admin) => (e: React.ChangeEvent<HTMLInputElement>) => setAdmin({ ...admin, [k]: e.target.value });

  async function submit() {
    let saved: Cooperative | undefined;
    const body: CooperativeInput = {
      ...f,
      location: f.location || null,
      contact_email: f.contact_email || null,
      contact_phone: f.contact_phone || null,
      estimated_daily_liters: f.estimated_daily_liters ? Number(f.estimated_daily_liters) : null,
    };
    const ok = await run(async () => {
      saved = cooperative
        ? await updateCooperative(cooperative.id, body)
        : await createCooperative({ ...body, admin: withAdmin ? admin : null });
    });
    if (ok && saved) onSaved(saved);
  }

  return (
    <FormDialog
      title={cooperative ? `Edit ${cooperative.name}` : 'New cooperative'}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      error={formError}
      submitLabel={cooperative ? 'Save changes' : 'Create cooperative'}
      wide
    >
      <Field label="Name" required error={fieldErrors.name}>
        {(p) => <input {...p} className={inputClass} value={f.name} onChange={set('name')} autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registration number" required error={fieldErrors.registration_number} hint="e.g. CS/12345">
          {(p) => <input {...p} className={inputClass} value={f.registration_number} onChange={set('registration_number')} />}
        </Field>
        <Field label="KRA PIN" required error={fieldErrors.kra_pin} hint="e.g. P051234567Z">
          {(p) => <input {...p} className={inputClass} value={f.kra_pin} onChange={set('kra_pin')} />}
        </Field>
        <Field label="County" required error={fieldErrors.county}>
          {(p) => (
            <select {...p} className={inputClass} value={f.county} onChange={set('county')}>
              <option value="">Choose a county</option>
              {KENYA_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <Field label="Town / sub-county" error={fieldErrors.location}>
          {(p) => <input {...p} className={inputClass} value={f.location} onChange={set('location')} />}
        </Field>
        <Field label="Contact email" error={fieldErrors.contact_email}>
          {(p) => <input {...p} type="email" className={inputClass} value={f.contact_email} onChange={set('contact_email')} />}
        </Field>
        <Field label="Contact phone" error={fieldErrors.contact_phone}>
          {(p) => <input {...p} type="tel" className={inputClass} value={f.contact_phone} onChange={set('contact_phone')} placeholder="0712 345 678" />}
        </Field>
        <Field label="Estimated litres per day" error={fieldErrors.estimated_daily_liters}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.estimated_daily_liters} onChange={set('estimated_daily_liters')} />}
        </Field>
      </div>

      {!cooperative && (
        <fieldset className="rounded-lg border border-[#DDE3DE] p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={withAdmin} onChange={(e) => setWithAdmin(e.target.checked)} className="size-4 accent-[#176044]" />
            Create the cooperative&apos;s administrator account
          </label>
          {withAdmin && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={fieldErrors['admin.full_name']}>
                {(p) => <input {...p} className={inputClass} value={admin.full_name} onChange={setA('full_name')} />}
              </Field>
              <Field label="Email" required error={fieldErrors['admin.email']}>
                {(p) => <input {...p} type="email" className={inputClass} value={admin.email} onChange={setA('email')} />}
              </Field>
              <Field label="Phone" required error={fieldErrors['admin.phone']}>
                {(p) => <input {...p} type="tel" className={inputClass} value={admin.phone} onChange={setA('phone')} />}
              </Field>
              <p className="self-end text-sm text-mo-muted">The administrator gets an SMS activation link and sets their own password. The SMS is billed to the platform.</p>
            </div>
          )}
        </fieldset>
      )}
    </FormDialog>
  );
}
