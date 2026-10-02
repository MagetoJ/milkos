'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search } from 'lucide-react';
import { useToast } from '@/app/superadmin/_components/toast';
import { createFarmer, listCentres, listFarmers, updateFarmer } from '../_api/coop-client';
import { formatNumber, formatPhone } from '../_lib/format';
import { useResource } from '../_lib/use-resource';
import { useSubmit } from '../_lib/use-submit';
import type { ActiveStatus, Centre, Farmer, FarmerInput } from '../_types/coop-types';
import { useCoop } from './coop-context';
import {
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingRows,
  Modal,
  PageHeader,
  Spinner,
  StatusPill,
  inputClass,
  primaryButton,
  secondaryButton,
} from './ui';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function FarmersView() {
  const { refresh } = useCoop();
  const toast = useToast();
  const params = useSearchParams();

  const [search, setSearch] = useState('');
  const [centre, setCentre] = useState('');
  const [status, setStatus] = useState<ActiveStatus | ''>('ACTIVE');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Farmer | 'new' | null>(null);

  const debouncedSearch = useDebounced(search);
  const centres = useResource(listCentres, []);
  const farmers = useResource(
    () => listFarmers({ search: debouncedSearch, centre, status, page, pageSize: PAGE_SIZE }),
    [debouncedSearch, centre, status, page],
  );

  // Links from the overview: ?centre=none shows farmers without a centre, ?new=1 opens the form.
  useEffect(() => {
    const filter = params.get('centre');
    if (filter) {
      setCentre(filter);
      setPage(1);
    }
    if (params.get('new') === '1') setEditing('new');
    if (filter || params.get('new')) window.history.replaceState(null, '', window.location.pathname);
  }, [params]);

  const total = farmers.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = !!(debouncedSearch.trim() || centre || status !== 'ACTIVE');

  // A search that ends up on a page past the last (e.g. after deactivating the last row) steps back.
  useEffect(() => {
    if (farmers.data && page > pages) setPage(pages);
  }, [farmers.data, page, pages]);

  async function saved(message: string) {
    setEditing(null);
    toast(message);
    await Promise.all([farmers.reload(), centres.reload(), refresh()]);
  }

  function changeFilter<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <>
      <PageHeader
        title="Farmers"
        subtitle="Everyone who delivers milk to your cooperative."
        action={
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" />
            Add farmer
          </button>
        }
      />

      {farmers.error && <div className="mb-4"><ErrorBanner message={farmers.error} onRetry={farmers.reload} /></div>}

      <section className="rounded-xl border border-[#DDE3DE] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#EEF1EC] px-4 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8A968F]" />
            <input
              type="search"
              value={search}
              onChange={(e) => changeFilter(setSearch)(e.target.value)}
              placeholder="Search name, phone, farmer number, ID or village"
              aria-label="Search farmers"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Filter by centre" value={centre} onChange={(e) => changeFilter(setCentre)(e.target.value)} className={`${inputClass} w-auto`}>
            <option value="">All centres</option>
            <option value="none">No centre assigned</option>
            {(centres.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.status === 'INACTIVE' ? ' (inactive)' : ''}</option>
            ))}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => changeFilter(setStatus)(e.target.value as ActiveStatus | '')} className={`${inputClass} w-auto`}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="">All</option>
          </select>
        </div>

        {farmers.loading && !farmers.data ? (
          <LoadingRows />
        ) : !farmers.data || farmers.data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No farmers match"
              body="Try a different search or clear the filters."
              action={<button onClick={() => { setSearch(''); setCentre(''); setStatus('ACTIVE'); setPage(1); }} className={secondaryButton}>Clear filters</button>}
            />
          ) : (
            <EmptyState
              title="No farmers yet"
              body="Register the farmers who deliver to your cooperative. You can assign each one to a collection centre."
              action={<button onClick={() => setEditing('new')} className={primaryButton}><Plus className="size-4" />Add your first farmer</button>}
            />
          )
        ) : (
          <div className={`overflow-x-auto ${farmers.loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#EEF1EC] text-xs uppercase tracking-wide text-[#8A968F]">
                <tr>
                  <th className="px-5 py-3 font-medium">Farmer</th>
                  <th className="px-3 py-3 font-medium">Phone</th>
                  <th className="px-3 py-3 font-medium">Village</th>
                  <th className="px-3 py-3 font-medium">Centre</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EC]">
                {farmers.data.items.map((f) => (
                  <tr key={f.id} className={f.status === 'INACTIVE' ? 'text-[#8A968F]' : ''}>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-[#17221D]">{f.full_name}</p>
                      <p className="text-xs text-[#8A968F]">{f.farmer_number}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{formatPhone(f.phone)}</td>
                    <td className="px-3 py-3.5">{f.village ?? <span className="text-[#B7C0BA]">–</span>}</td>
                    <td className="px-3 py-3.5">{f.centre_name ?? <span className="text-[#8A968F]">Not assigned</span>}</td>
                    <td className="px-3 py-3.5"><StatusPill active={f.status === 'ACTIVE'} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => setEditing(f)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-[#176044] hover:bg-[#EEF1EC]" aria-label={`Edit ${f.full_name}`}>
                        <Pencil className="size-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF1EC] px-4 py-3 text-sm text-[#5E6B64]">
            <span>Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className={secondaryButton} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
                <span className="tabular-nums">Page {page} of {pages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages} className={secondaryButton} aria-label="Next page"><ChevronRight className="size-4" /></button>
              </div>
            )}
          </div>
        )}
      </section>

      {editing && (
        <FarmerForm
          farmer={editing === 'new' ? null : editing}
          centres={centres.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

function FarmerForm({
  farmer,
  centres,
  onClose,
  onSaved,
}: {
  farmer: Farmer | null;
  centres: Centre[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  const [firstName, setFirstName] = useState(farmer?.first_name ?? '');
  const [lastName, setLastName] = useState(farmer?.last_name ?? '');
  const [phone, setPhone] = useState(farmer ? formatPhone(farmer.phone) : '');
  const [nationalId, setNationalId] = useState(farmer?.national_id ?? '');
  const [village, setVillage] = useState(farmer?.village ?? '');
  const [centreId, setCentreId] = useState(farmer?.centre_id ?? '');
  const [number, setNumber] = useState(farmer?.farmer_number ?? '');

  // Inactive centres can't take new farmers, but a farmer already there keeps showing it.
  const options = centres.filter((c) => c.status === 'ACTIVE' || c.id === farmer?.centre_id);

  function payload(): FarmerInput {
    const input: FarmerInput = {
      first_name: firstName,
      last_name: lastName,
      phone,
      national_id: nationalId.trim() || null,
      village: village.trim() || null,
      centre_id: centreId || null,
    };
    if (number.trim()) input.farmer_number = number;
    return input;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      if (farmer) await updateFarmer(farmer.id, payload());
      else await createFarmer(payload());
    });
    if (ok) await onSaved(`${`${firstName} ${lastName}`.trim()} ${farmer ? 'updated' : 'added'}.`);
  }

  async function setStatus(status: ActiveStatus) {
    if (!farmer) return;
    const ok = await run(async () => void (await updateFarmer(farmer.id, { status })));
    if (ok) await onSaved(`${farmer.full_name} ${status === 'INACTIVE' ? 'deactivated' : 'reactivated'}.`);
    else setConfirming(false);
  }

  if (confirming && farmer) {
    return (
      <ConfirmModal
        title={`Deactivate ${farmer.full_name}?`}
        body="They stay in your records with their history but will be marked inactive. You can reactivate them at any time."
        confirmLabel="Deactivate"
        danger
        busy={busy}
        error={formError}
        onConfirm={() => setStatus('INACTIVE')}
        onClose={() => setConfirming(false)}
      />
    );
  }

  return (
    <Modal title={farmer ? `Edit ${farmer.full_name}` : 'Add farmer'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.first_name}>
            {(p) => <input {...p} className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus maxLength={100} />}
          </Field>
          <Field label="Last name" required error={fieldErrors.last_name}>
            {(p) => <input {...p} className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" required error={fieldErrors.phone} hint="Used for SMS notifications.">
            {(p) => <input {...p} className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />}
          </Field>
          <Field label="National ID" error={fieldErrors.national_id} hint="7 or 8 digits. Optional.">
            {(p) => <input {...p} className={inputClass} inputMode="numeric" value={nationalId} onChange={(e) => setNationalId(e.target.value)} maxLength={8} />}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Village" error={fieldErrors.village}>
            {(p) => <input {...p} className={inputClass} value={village} onChange={(e) => setVillage(e.target.value)} maxLength={150} />}
          </Field>
          <Field label="Collection centre" error={fieldErrors.centre_id} hint={options.length === 0 ? 'Add a collection centre first.' : undefined}>
            {(p) => (
              <select {...p} className={inputClass} value={centreId} onChange={(e) => setCentreId(e.target.value)}>
                <option value="">Not assigned</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'INACTIVE' ? ' (inactive)' : ''}</option>)}
              </select>
            )}
          </Field>
        </div>

        <Field label="Farmer number" error={fieldErrors.farmer_number} hint={farmer ? undefined : 'Leave blank to assign the next one automatically (F-0001).'}>
          {(p) => <input {...p} className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="F-0001" maxLength={50} />}
        </Field>

        {formError && <ErrorBanner message={formError} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>
            {farmer &&
              (farmer.status === 'ACTIVE' ? (
                <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-[#B42318] hover:underline">Deactivate farmer</button>
              ) : (
                <button type="button" onClick={() => setStatus('ACTIVE')} disabled={busy} className="text-sm font-medium text-[#176044] hover:underline">Reactivate farmer</button>
              ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <Spinner />}
              {farmer ? 'Save changes' : 'Add farmer'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}