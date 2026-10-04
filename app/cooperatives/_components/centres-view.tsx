'use client';

import { useReloadOn } from '@/lib/sync/hooks';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Pencil, Plus, Snowflake } from 'lucide-react';
import { KENYAN_COUNTIES } from '@/app/(auth)/_lib/onboarding-rules';
import { useToast } from '@/app/superadmin/_components/toast';
import { createCentre, listCentres, listTeam, updateCentre } from '../_api/coop-client';
import { formatNumber } from '../_lib/format';
import { useResource } from '../_lib/use-resource';
import { useSubmit } from '../_lib/use-submit';
import type { Centre, CentreInput, TeamMember } from '../_types/coop-types';
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

export function CentresView() {
  const { refresh } = useCoop();
  const toast = useToast();
  const params = useSearchParams();
  const centres = useResource(listCentres, []);
  const team = useResource(listTeam, []);
  useReloadOn(['centres', 'team', 'farmers'], () => Promise.all([centres.reload(), team.reload()]));
  const [editing, setEditing] = useState<Centre | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  const managers = useMemo(() => (team.data ?? []).filter((m) => m.role === 'MANAGER' && m.is_active), [team.data]);

  // "Add centre" links elsewhere open this screen with ?new=1
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing('new');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [params]);

  const rows = (centres.data ?? []).filter((c) => showInactive || c.status === 'ACTIVE');
  const hasInactive = (centres.data ?? []).some((c) => c.status === 'INACTIVE');

  async function saved(message: string) {
    setEditing(null);
    toast(message);
    await Promise.all([centres.reload(), refresh()]);
  }

  return (
    <>
      <PageHeader
        title="Collection centres"
        subtitle="Where your farmers deliver milk."
        action={
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" />
            Add centre
          </button>
        }
      />

      {centres.error && <div className="mb-4"><ErrorBanner message={centres.error} onRetry={centres.reload} /></div>}

      <section className="overflow-hidden rounded-xl border border-[#DDE3DE] bg-white">
        {hasInactive && (
          <div className="flex justify-end border-b border-[#EEF1EC] px-5 py-2.5">
            <label className="flex items-center gap-2 text-sm text-[#5E6B64]">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-[#176044]" />
              Show inactive centres
            </label>
          </div>
        )}

        {centres.loading && !centres.data ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No collection centres yet"
            body="Add the places where farmers bring their milk, then assign each farmer to one."
            action={
              <button onClick={() => setEditing('new')} className={primaryButton}>
                <Plus className="size-4" />
                Add your first centre
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#EEF1EC] text-xs uppercase tracking-wide text-[#8A968F]">
                <tr>
                  <th className="px-5 py-3 font-medium">Centre</th>
                  <th className="px-3 py-3 font-medium">Location</th>
                  <th className="px-3 py-3 font-medium">Manager</th>
                  <th className="px-3 py-3 font-medium">Cooler</th>
                  <th className="px-3 py-3 text-right font-medium">Farmers</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EC]">
                {rows.map((c) => (
                  <tr key={c.id} className={c.status === 'INACTIVE' ? 'text-[#8A968F]' : ''}>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-[#17221D]">{c.name}</p>
                      <p className="text-xs text-[#8A968F]">{c.code}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      {c.county}
                      {c.location_description && <p className="max-w-[16rem] truncate text-xs text-[#8A968F]" title={c.location_description}>{c.location_description}</p>}
                    </td>
                    <td className="px-3 py-3.5">{c.manager_name ?? <span className="text-[#8A968F]">None assigned</span>}</td>
                    <td className="px-3 py-3.5">
                      {c.has_cooler ? (
                        <span className="inline-flex items-center gap-1">
                          <Snowflake className="size-3.5 text-[#176044]" />
                          {c.cooler_capacity_litres ? `${formatNumber(c.cooler_capacity_litres)} L` : 'Yes'}
                        </span>
                      ) : (
                        <span className="text-[#8A968F]">No</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums">{formatNumber(c.farmer_count)}</td>
                    <td className="px-3 py-3.5"><StatusPill active={c.status === 'ACTIVE'} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-[#176044] hover:bg-[#EEF1EC]" aria-label={`Edit ${c.name}`}>
                        <Pencil className="size-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <CentreForm
          centre={editing === 'new' ? null : editing}
          managers={managers}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

function CentreForm({
  centre,
  managers,
  onClose,
  onSaved,
}: {
  centre: Centre | null;
  managers: TeamMember[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { overview } = useCoop();
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(centre?.name ?? '');
  const [code, setCode] = useState(centre?.code ?? '');
  const [county, setCounty] = useState(centre?.county ?? overview.cooperative.county);
  const [location, setLocation] = useState(centre?.location_description ?? '');
  const [managerId, setManagerId] = useState(centre?.manager_user_id ?? '');
  const [hasCooler, setHasCooler] = useState(centre?.has_cooler ?? false);
  const [capacity, setCapacity] = useState(centre?.cooler_capacity_litres ? String(centre.cooler_capacity_litres) : '');

  // The saved manager may since have been deactivated; keep showing them rather than silently clearing it.
  const managerOptions = useMemo(() => {
    const options = [...managers];
    if (centre?.manager_user_id && !options.some((m) => m.id === centre.manager_user_id)) {
      options.push({ id: centre.manager_user_id, full_name: `${centre.manager_name ?? 'Former manager'} (inactive)` } as TeamMember);
    }
    return options;
  }, [managers, centre]);

  function payload(): CentreInput {
    const input: CentreInput = {
      name,
      county,
      location_description: location.trim() || null,
      manager_user_id: managerId || null,
      has_cooler: hasCooler,
      cooler_capacity_litres: hasCooler && capacity.trim() ? Number(capacity) : null,
    };
    if (code.trim() || centre) input.code = code;
    return input;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      if (centre) await updateCentre(centre.id, payload());
      else await createCentre(payload());
    });
    if (ok) await onSaved(centre ? `${name.trim()} updated.` : `${name.trim()} added.`);
  }

  async function setStatus(status: 'ACTIVE' | 'INACTIVE') {
    if (!centre) return;
    const ok = await run(async () => void (await updateCentre(centre.id, { status })));
    if (ok) await onSaved(status === 'INACTIVE' ? `${centre.name} deactivated.` : `${centre.name} reactivated.`);
    else setConfirming(false);
  }

  if (confirming && centre) {
    return (
      <ConfirmModal
        title={`Deactivate ${centre.name}?`}
        body={
          <p>
            It will stay in your records but be marked inactive.
            {centre.farmer_count > 0 && ` ${formatNumber(centre.farmer_count)} active ${centre.farmer_count === 1 ? 'farmer is' : 'farmers are'} still assigned to it; reassign them from the Farmers page.`}
          </p>
        }
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
    <Modal title={centre ? `Edit ${centre.name}` : 'Add collection centre'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" required error={fieldErrors.name}>
          {(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Limuru Main Centre" autoFocus maxLength={255} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" error={fieldErrors.code} hint={centre ? undefined : 'Leave blank to generate one (CTR-001).'}>
            {(p) => <input {...p} className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="CTR-001" maxLength={50} />}
          </Field>
          <Field label="County" required error={fieldErrors.county}>
            {(p) => (
              <select {...p} className={inputClass} value={county} onChange={(e) => setCounty(e.target.value)}>
                {KENYAN_COUNTIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            )}
          </Field>
        </div>

        <Field label="Location details" error={fieldErrors.location_description} hint="Town, landmark or directions.">
          {(p) => <textarea {...p} className={inputClass} rows={2} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={1000} />}
        </Field>

        <Field label="Centre manager" error={fieldErrors.manager_user_id} hint={managerOptions.length === 0 ? 'Add a manager on the Team page first.' : undefined}>
          {(p) => (
            <select {...p} className={inputClass} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No manager assigned</option>
              {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          )}
        </Field>

        <div className="space-y-3 rounded-lg border border-[#DDE3DE] p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={hasCooler} onChange={(e) => setHasCooler(e.target.checked)} className="size-4 accent-[#176044]" />
            This centre has a cooling tank
          </label>
          {hasCooler && (
            <Field label="Cooler capacity (litres)" error={fieldErrors.cooler_capacity_litres}>
              {(p) => <input {...p} className={inputClass} inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 2000" />}
            </Field>
          )}
        </div>

        {formError && <ErrorBanner message={formError} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>
            {centre &&
              (centre.status === 'ACTIVE' ? (
                <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-[#B42318] hover:underline">Deactivate centre</button>
              ) : (
                <button type="button" onClick={() => setStatus('ACTIVE')} disabled={busy} className="text-sm font-medium text-[#176044] hover:underline">Reactivate centre</button>
              ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <Spinner />}
              {centre ? 'Save changes' : 'Add centre'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}