'use client';

import { useReloadOn } from '@/lib/sync/hooks';
import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Snowflake, Truck } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  Field,
  FormDialog,
  Muted,
  PageHeader,
  PrimaryCell,
  StatusBadge,
  inputClass,
  primaryButton,
  secondaryButton,
  type Column,
} from '@/components/admin';
import type { Collector, Cooler } from '@/app/superadmin/_types/platform-types';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatLitres, formatNumber, formatPhone } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { createCooler, listCollectors, listCoolers, listTeam, updateCollector, updateCooler } from '../_api/coop-client';
import { useCoop } from './coop-context';

/** Coolers and which collector delivers where. Collectors themselves are added on the Team page. */
export function OperationsView() {
  const { overview, refresh } = useCoop();
  const isAdmin = overview.role === 'COOP_ADMIN';
  const toast = useToast();
  const coolers = useResource(listCoolers, []);
  const collectors = useResource(listCollectors, []);
  useReloadOn(['coolers', 'collectors'], () => Promise.all([coolers.reload(), collectors.reload()]));
  const [editingCooler, setEditingCooler] = useState<Cooler | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Collector | null>(null);

  async function toggle(cooler: Cooler, data: { is_operational?: boolean; status?: 'ACTIVE' | 'INACTIVE' }, message: string) {
    try {
      await updateCooler(cooler.id, data);
      toast(message);
      await Promise.all([coolers.reload(), refresh()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the cooler.', 'error');
    }
  }

  const coolerColumns: Column<Cooler>[] = [
    { key: 'name', header: 'Cooler', cell: (c) => <PrimaryCell title={c.name} subtitle={c.code} /> },
    { key: 'loc', header: 'Location', cell: (c) => c.location ?? <Muted /> },
    { key: 'cap', header: 'Capacity', align: 'right', cell: (c) => (c.capacity_litres ? formatLitres(c.capacity_litres) : <Muted />) },
    { key: 'today', header: 'Received today', align: 'right', cell: (c) => formatLitres(c.litres_today) },
    {
      key: 'state',
      header: 'State',
      cell: (c) =>
        c.status === 'INACTIVE' ? <StatusBadge status="INACTIVE" label="Decommissioned" /> : c.is_operational ? <StatusBadge status="ONLINE" label="Operational" /> : <StatusBadge status="OFFLINE" label="Offline" />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (c) => (
        <span className="inline-flex flex-wrap justify-end gap-3 text-sm font-medium">
          {c.status === 'ACTIVE' && (
            <button onClick={() => toggle(c, { is_operational: !c.is_operational }, `${c.name} marked ${c.is_operational ? 'offline' : 'operational'}.`)} className="text-[#176044] hover:underline">
              Mark {c.is_operational ? 'offline' : 'operational'}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => toggle(c, { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, `${c.name} ${c.status === 'ACTIVE' ? 'decommissioned' : 'returned to service'}.`)}
              className={c.status === 'ACTIVE' ? 'text-[#B42318] hover:underline' : 'text-[#176044] hover:underline'}
            >
              {c.status === 'ACTIVE' ? 'Decommission' : 'Return to service'}
            </button>
          )}
          <button onClick={() => setEditingCooler(c)} className="inline-flex items-center gap-1 text-[#176044] hover:underline" aria-label={`Edit ${c.name}`}>
            <Pencil className="size-3.5" /> Edit
          </button>
        </span>
      ),
    },
  ];

  const collectorColumns: Column<Collector>[] = [
    { key: 'name', header: 'Collector', cell: (c) => <PrimaryCell title={c.full_name} subtitle={`${c.collector_number} · ${formatPhone(c.phone)}`} /> },
    { key: 'area', header: 'Area / route', cell: (c) => c.assigned_area ?? <Muted>Not set</Muted> },
    { key: 'cooler', header: 'Delivers to', cell: (c) => c.cooler_name ?? <Muted>No cooler</Muted> },
    { key: 'litres', header: 'Milk collected', align: 'right', cell: (c) => formatLitres(c.stats.total_litres) },
    { key: 'count', header: 'Collections', align: 'right', cell: (c) => formatNumber(c.stats.collections) },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'assign',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (c) => (
        <button onClick={() => setAssigning(c)} className="text-sm font-medium text-[#176044] hover:underline">
          Assign
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Field operations"
        subtitle="Your coolers, and which collector covers which area and cooler."
        action={
          <Link href="/collections" className={secondaryButton}>
            Milk collections
          </Link>
        }
      />
      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Coolers</h2>
            {isAdmin && (
              <button onClick={() => setEditingCooler('new')} className={primaryButton}>
                <Plus className="size-4" /> Add cooler
              </button>
            )}
          </div>
          <DataTable
            columns={coolerColumns}
            rows={coolers.data}
            rowKey={(c) => c.id}
            loading={coolers.loading}
            error={coolers.error}
            onRetry={coolers.reload}
            minWidth="720px"
            mobileCards
            empty={<EmptyState icon={<Snowflake className="size-8" />} title="No coolers yet" body={isAdmin ? 'Add the coolers your collectors deliver to.' : 'Your cooperative admin adds coolers.'} />}
          />
        </section>
        <section>
          <h2 className="mb-1 text-base font-semibold">Collectors</h2>
          <p className="mb-3 text-sm text-[#5E6B64]">
            Add collectors on the <Link href="/cooperatives/team" className="font-medium text-[#176044] hover:underline">Team</Link> page; assign their area and cooler here.
          </p>
          <DataTable
            columns={collectorColumns}
            rows={collectors.data}
            rowKey={(c) => c.id}
            loading={collectors.loading}
            error={collectors.error}
            onRetry={collectors.reload}
            minWidth="720px"
            mobileCards
            empty={<EmptyState icon={<Truck className="size-8" />} title="No collectors yet" body="Add a team member with the Collector role." />}
          />
        </section>
      </div>

      {editingCooler && (
        <CoolerDialog
          cooler={editingCooler === 'new' ? null : editingCooler}
          onClose={() => setEditingCooler(null)}
          onSaved={async (message) => {
            setEditingCooler(null);
            toast(message);
            await Promise.all([coolers.reload(), refresh()]);
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          collector={assigning}
          coolers={(coolers.data ?? []).filter((c) => c.status === 'ACTIVE')}
          onClose={() => setAssigning(null)}
          onSaved={async () => {
            setAssigning(null);
            toast(`${assigning.full_name}'s assignment saved.`);
            await collectors.reload();
          }}
        />
      )}
    </>
  );
}

function CoolerDialog({ cooler, onClose, onSaved }: { cooler: Cooler | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [f, setF] = useState({
    name: cooler?.name ?? '',
    location: cooler?.location ?? '',
    capacity_litres: cooler?.capacity_litres?.toString() ?? '',
    scale_device_id: cooler?.scale_device_id ?? '',
    manager_user_id: cooler?.manager_user_id ?? '',
    low_volume_alert_litres: cooler?.low_volume_alert_litres?.toString() ?? '',
    high_volume_alert_litres: cooler?.high_volume_alert_litres?.toString() ?? '',
    min_temperature_c: cooler?.min_temperature_c?.toString() ?? '',
    max_temperature_c: cooler?.max_temperature_c?.toString() ?? '',
    stale_after_minutes: cooler?.stale_after_minutes?.toString() ?? '',
    low_battery_percent: cooler?.low_battery_percent?.toString() ?? '',
  });
  const team = useResource(listTeam, []);
  const managers = (team.data ?? []).filter((m) => m.is_active && (m.role === 'MANAGER' || m.role === 'COOP_ADMIN'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  async function submit() {
    const body = {
      name: f.name,
      location: f.location || null,
      capacity_litres: f.capacity_litres ? Number(f.capacity_litres) : null,
      scale_device_id: f.scale_device_id || null,
      manager_user_id: f.manager_user_id || null,
      low_volume_alert_litres: num(f.low_volume_alert_litres),
      high_volume_alert_litres: num(f.high_volume_alert_litres),
      min_temperature_c: num(f.min_temperature_c),
      max_temperature_c: num(f.max_temperature_c),
      stale_after_minutes: num(f.stale_after_minutes),
      low_battery_percent: num(f.low_battery_percent),
    };
    if (await run(async () => void (cooler ? await updateCooler(cooler.id, body) : await createCooler(body)))) {
      await onSaved(`${f.name} ${cooler ? 'updated' : 'added'}.`);
    }
  }
  return (
    <FormDialog title={cooler ? `Edit ${cooler.name}` : 'Add cooler'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel={cooler ? 'Save changes' : 'Add cooler'}>
      <Field label="Name" required error={fieldErrors.name}>
        {(p) => <input {...p} className={inputClass} value={f.name} onChange={set('name')} autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
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
      <Field label="Manager in charge" error={fieldErrors.manager_user_id} hint="Receives this cooler's SMS alerts with the cooperative admins.">
        {(p) => (
          <select {...p} className={inputClass} value={f.manager_user_id} onChange={set('manager_user_id')}>
            <option value="">Centre&apos;s manager (or none)</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        )}
      </Field>
      <fieldset className="space-y-3 rounded-lg border border-[#DDE3DE] px-3 pb-3 pt-2">
        <legend className="px-1 text-sm font-medium">Alerts (leave empty to switch one off)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Alert below (litres)" error={fieldErrors.low_volume_alert_litres}>
            {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.low_volume_alert_litres} onChange={set('low_volume_alert_litres')} />}
          </Field>
          <Field label="Alert above (litres)" error={fieldErrors.high_volume_alert_litres}>
            {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.high_volume_alert_litres} onChange={set('high_volume_alert_litres')} />}
          </Field>
          <Field label="Min. temperature °C" error={fieldErrors.min_temperature_c}>
            {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.min_temperature_c} onChange={set('min_temperature_c')} />}
          </Field>
          <Field label="Max. temperature °C" error={fieldErrors.max_temperature_c}>
            {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.max_temperature_c} onChange={set('max_temperature_c')} />}
          </Field>
          <Field label="No reading for (minutes)" error={fieldErrors.stale_after_minutes}>
            {(p) => <input {...p} inputMode="numeric" className={inputClass} value={f.stale_after_minutes} onChange={set('stale_after_minutes')} />}
          </Field>
          <Field label="Sensor battery below (%)" error={fieldErrors.low_battery_percent}>
            {(p) => <input {...p} inputMode="numeric" className={inputClass} value={f.low_battery_percent} onChange={set('low_battery_percent')} />}
          </Field>
        </div>
      </fieldset>
    </FormDialog>
  );
}

function AssignDialog({ collector, coolers, onClose, onSaved }: { collector: Collector; coolers: Cooler[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [area, setArea] = useState(collector.assigned_area ?? '');
  const [coolerId, setCoolerId] = useState(collector.cooler_id ?? '');
  async function submit() {
    if (await run(async () => void (await updateCollector(collector.id, { assigned_area: area || null, cooler_id: coolerId || null })))) await onSaved();
  }
  return (
    <FormDialog title={`Assign ${collector.full_name}`} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel="Save assignment">
      <Field label="Area / route" error={fieldErrors.assigned_area}>
        {(p) => <input {...p} className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Tigoni ridge" autoFocus />}
      </Field>
      <Field label="Delivers to cooler" error={fieldErrors.cooler_id} hint="Used by default when they record milk.">
        {(p) => (
          <select {...p} className={inputClass} value={coolerId} onChange={(e) => setCoolerId(e.target.value)}>
            <option value="">No cooler</option>
            {coolers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
        )}
      </Field>
    </FormDialog>
  );
}
