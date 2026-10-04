'use client';

import { useState } from 'react';
import { RefreshCw, Smartphone } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  EmptyState,
  Muted,
  PageHeader,
  Pagination,
  PrimaryCell,
  StatCard,
  StatusBadge,
  Tabs,
  secondaryButton,
  type Column,
} from '@/components/admin';
import { formatDateTime, formatLitres, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { getSyncHealth, listCoolerReadings, listDevices, listNotifications, updateDevice } from '../../_api/superadmin-client';
import type { AlertNotification, CoolerReading, Device, SyncHealth } from '../../_types/platform-types';
import { useToast } from '../toast';

type Tab = 'health' | 'devices' | 'readings' | 'notifications';

/** Offline operations across the platform: the same server records the cooperatives' devices synced. */
export function SyncView() {
  const [tab, setTab] = useState<Tab>('health');
  const health = useResource(getSyncHealth, []);
  const t = health.data?.totals;
  return (
    <>
      <PageHeader
        title="Sync & devices"
        subtitle="Offline devices, what they synchronised, cooler readings and alert delivery across all cooperatives."
        action={
          <button className={secondaryButton} onClick={health.reload}>
            <RefreshCw className="size-4" /> Refresh
          </button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Devices" value={t ? formatNumber(t.devices) : '–'} hint={t ? `${formatNumber(t.active_sessions)} active offline sessions` : undefined} />
        <StatCard label="Changes synced (24 h)" value={t ? formatNumber(t.applied_24h) : '–'} />
        <StatCard label="Open conflicts" value={t ? formatNumber(t.open_conflicts) : '–'} />
        <StatCard label="Failed SMS alerts" value={t ? formatNumber(t.failed_notifications) : '–'} hint={t ? `${formatNumber(t.readings_24h)} cooler readings in 24 h` : undefined} />
      </div>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'health', label: 'By cooperative' },
          { value: 'devices', label: 'Devices' },
          { value: 'readings', label: 'Cooler readings' },
          { value: 'notifications', label: 'Alerts & SMS' },
        ]}
      />
      <div>
        {tab === 'health' && <HealthTable data={health.data} loading={health.loading} error={health.error} onRetry={health.reload} />}
        {tab === 'devices' && <DevicesTable />}
        {tab === 'readings' && <ReadingsTable />}
        {tab === 'notifications' && <NotificationsTable />}
      </div>
    </>
  );
}

function HealthTable({ data, loading, error, onRetry }: { data: SyncHealth | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const columns: Column<SyncHealth['cooperatives'][number]>[] = [
    { key: 'coop', header: 'Cooperative', cell: (r) => <PrimaryCell title={r.cooperative_name} subtitle={r.cooperative_code} /> },
    { key: 'devices', header: 'Devices', align: 'right', cell: (r) => `${r.active_devices} / ${r.devices}` },
    { key: 'last', header: 'Last sync', cell: (r) => (r.last_sync_at ? formatDateTime(r.last_sync_at) : <Muted>Never</Muted>) },
    { key: 'applied', header: 'Synced (24 h)', align: 'right', cell: (r) => formatNumber(r.applied_24h) },
    { key: 'rejected', header: 'Refused (24 h)', align: 'right', cell: (r) => formatNumber(r.rejected_24h) },
    { key: 'conflicts', header: 'Open conflicts', align: 'right', cell: (r) => (r.open_conflicts ? <StatusBadge status="PENDING" label={String(r.open_conflicts)} /> : '0') },
    { key: 'readings', header: 'Readings (24 h)', align: 'right', cell: (r) => formatNumber(r.readings_24h) },
    { key: 'sms', header: 'Failed SMS', align: 'right', cell: (r) => (r.failed_notifications ? <StatusBadge status="REJECTED" label={String(r.failed_notifications)} /> : '0') },
  ];
  return (
    <DataTable
      columns={columns}
      rows={data?.cooperatives}
      rowKey={(r) => r.cooperative_id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth="860px"
      empty={<EmptyState title="No cooperatives yet" />}
    />
  );
}

function DevicesTable() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const devices = useResource(() => listDevices({ page, page_size: 25 }), [page]);
  const [confirm, setConfirm] = useState<{ device: Device; action: 'deactivate' | 'activate' | 'release' } | null>(null);
  const columns: Column<Device>[] = [
    { key: 'device', header: 'Device', cell: (d) => <PrimaryCell title={d.label ?? d.platform ?? 'Device'} subtitle={d.device_identifier.slice(0, 8)} /> },
    { key: 'coop', header: 'Cooperative', cell: (d) => d.cooperative_name ?? <Muted>Not bound</Muted> },
    { key: 'version', header: 'App', cell: (d) => d.app_version ?? <Muted /> },
    { key: 'seen', header: 'Last seen', cell: (d) => (d.last_seen_at ? formatDateTime(d.last_seen_at) : <Muted>Never</Muted>) },
    { key: 'sync', header: 'Last sync', cell: (d) => (d.last_sync_at ? formatDateTime(d.last_sync_at) : <Muted>Never</Muted>) },
    { key: 'state', header: 'Status', cell: (d) => <StatusBadge status={d.is_active ? 'ACTIVE' : 'INACTIVE'} label={d.is_active ? 'Active' : 'Deactivated'} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (d) => (
        <span className="inline-flex gap-3 text-sm font-medium">
          <button className={d.is_active ? 'text-[#B42318] hover:underline' : 'text-[#176044] hover:underline'} onClick={() => setConfirm({ device: d, action: d.is_active ? 'deactivate' : 'activate' })}>
            {d.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          {d.cooperative_id && (
            <button className="text-[#176044] hover:underline" onClick={() => setConfirm({ device: d, action: 'release' })}>
              Release
            </button>
          )}
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={devices.data?.items}
        rowKey={(d) => d.id}
        loading={devices.loading}
        error={devices.error}
        onRetry={devices.reload}
        minWidth="820px"
        empty={<EmptyState icon={<Smartphone className="size-8" />} title="No devices yet" body="Devices appear after a cooperative user signs in on them." />}
        footer={<Pagination page={page} pageSize={25} total={devices.data?.total ?? 0} onPage={setPage} />}
      />
      {confirm && (
        <ConfirmationDialog
          title={confirm.action === 'release' ? 'Release this device?' : confirm.action === 'deactivate' ? 'Deactivate this device?' : 'Reactivate this device?'}
          body={
            confirm.action === 'release'
              ? 'It is unbound from its cooperative and every offline session on it ends. Changes still queued on it will be refused until a user signs in again.'
              : confirm.action === 'deactivate'
                ? 'Its offline sessions end and it can no longer sync until reactivated.'
                : 'Users will be able to sign in and sync on it again.'
          }
          confirmLabel={confirm.action === 'release' ? 'Release' : confirm.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
          danger={confirm.action !== 'activate'}
          onConfirm={async () => {
            if (confirm.action === 'release') await updateDevice(confirm.device.id, {}, true);
            else await updateDevice(confirm.device.id, { is_active: confirm.action === 'activate' });
            setConfirm(null);
            toast('Device updated.');
            await devices.reload();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function ReadingsTable() {
  const [page, setPage] = useState(1);
  const readings = useResource(() => listCoolerReadings({ page, page_size: 25 }), [page]);
  const columns: Column<CoolerReading>[] = [
    { key: 'cooler', header: 'Cooler', cell: (r) => <PrimaryCell title={r.cooler_name ?? 'Cooler'} subtitle={r.cooperative_name} /> },
    { key: 'volume', header: 'Volume', align: 'right', cell: (r) => (r.volume_litres == null ? <Muted /> : formatLitres(r.volume_litres)) },
    { key: 'temp', header: 'Temp.', align: 'right', cell: (r) => (r.temperature_celsius == null ? <Muted /> : `${r.temperature_celsius} °C`) },
    { key: 'measured', header: 'Measured', cell: (r) => formatDateTime(r.measured_at) },
    { key: 'source', header: 'Source', cell: (r) => <StatusBadge status={r.source} tone={r.source === 'SIMULATED' ? 'blue' : 'grey'} /> },
    {
      key: 'quality',
      header: 'Quality',
      cell: (r) => (
        <span title={r.quality_flags.join(', ') || undefined}>
          <StatusBadge status={r.quality} tone={r.quality === 'VALID' ? 'green' : r.quality === 'SIMULATED' ? 'blue' : 'amber'} />
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={readings.data?.items}
      rowKey={(r) => r.id}
      loading={readings.loading}
      error={readings.error}
      onRetry={readings.reload}
      minWidth="760px"
      empty={<EmptyState title="No cooler readings yet" />}
      footer={<Pagination page={page} pageSize={25} total={readings.data?.total ?? 0} onPage={setPage} />}
    />
  );
}

function NotificationsTable() {
  const [page, setPage] = useState(1);
  const notes = useResource(() => listNotifications({ page, page_size: 25 }), [page]);
  const tone = (s: AlertNotification['status']) => (s === 'SENT' ? 'green' : s === 'FAILED' ? 'red' : s === 'SKIPPED' ? 'grey' : 'amber');
  const columns: Column<AlertNotification>[] = [
    { key: 'type', header: 'Alert', cell: (n) => <PrimaryCell title={n.type.replace(/_/g, ' ').toLowerCase()} subtitle={n.cooperative_name} /> },
    { key: 'to', header: 'To', cell: (n) => n.recipient_phone },
    { key: 'status', header: 'Delivery', cell: (n) => <span title={n.error ?? undefined}><StatusBadge status={n.status} tone={tone(n.status)} /></span> },
    { key: 'attempts', header: 'Attempts', align: 'right', cell: (n) => n.attempts },
    { key: 'created', header: 'Created', cell: (n) => formatDateTime(n.created_at) },
    { key: 'sent', header: 'Sent', cell: (n) => (n.sent_at ? formatDateTime(n.sent_at) : <Muted />) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={notes.data?.items}
      rowKey={(n) => n.id}
      loading={notes.loading}
      error={notes.error}
      onRetry={notes.reload}
      minWidth="760px"
      empty={<EmptyState title="No alerts yet" body="Cooler alerts appear here with their SMS delivery state." />}
      footer={<Pagination page={page} pageSize={25} total={notes.data?.total ?? 0} onPage={setPage} />}
    />
  );
}
