'use client';

// Collector settings (phone-first). Profile, phone, password and two-step verification, collection preferences,
// notifications, this device (scale, Bluetooth, sync, offline access) and signed-in sessions.
// Non-sensitive preferences are readable offline; anything security-related needs a connection.
import { useEffect, useState } from 'react';
import { Bluetooth, RefreshCw, Scale, Smartphone } from 'lucide-react';
import { AccountSettings, type WorkOption } from '@/components/settings/account-settings';
import { SettingsCard, ValueRow } from '@/components/settings/settings-ui';
import { listCentres, listCoolers } from '@/app/cooperatives/_api/coop-client';
import { isBluetoothSupported } from '@/lib/bluetooth/capability';
import { formatDateTime } from '@/lib/format';
import { getDeviceId } from '@/lib/offline/device';
import { availableScaleAdapters, hardwareScaleNote } from '@/lib/scale/registry';
import { useConnectivity, useSyncState } from '@/lib/sync/hooks';

function ThisDevice() {
  const sync = useSyncState();
  const connectivity = useConnectivity();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bluetooth, setBluetooth] = useState<boolean | null>(null);
  const [scales, setScales] = useState<string[]>([]);
  useEffect(() => {
    getDeviceId().then(setDeviceId, () => setDeviceId(null));
    setBluetooth(isBluetoothSupported());
    setScales(availableScaleAdapters().map((d) => d.label));
  }, []);
  const waiting = sync.counts.pending + sync.counts.syncing + sync.counts.failed + sync.counts.conflict;
  const note = hardwareScaleNote();
  return (
    <SettingsCard id="device" title="This phone" description="How this phone works with MilkOS.">
      <dl className="divide-y divide-mo-line">
        <ValueRow label="Device ID" value={deviceId ? <span className="font-mono">{deviceId.slice(0, 8)}…</span> : 'Not set up'} />
        <ValueRow label="Connection" value={connectivity.network && connectivity.server !== 'unreachable' ? 'Online' : 'Offline'} />
        <ValueRow label="Offline access until" value={sync.offlineSessionExpiresAt ? formatDateTime(sync.offlineSessionExpiresAt) : 'Not set up: sign in online once'} />
        <ValueRow label="Last sync" value={sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : 'Never'} />
        <ValueRow label="Waiting to sync" value={waiting ? `${waiting} record${waiting === 1 ? '' : 's'}` : 'Nothing'} />
        <ValueRow label="Bluetooth" value={bluetooth === null ? '…' : bluetooth ? 'Available in this browser' : 'Not available in this browser'} />
        <ValueRow label="Scales you can connect" value={scales.length ? scales.join(', ') : 'None yet'} />
      </dl>
      {note && <p className="mt-3 flex items-start gap-2 text-sm text-mo-muted"><Scale aria-hidden className="mt-0.5 size-4 shrink-0" />{note}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a href="/collector/sync" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-mo-line-strong px-4 font-medium text-mo-ink hover:bg-mo-hover">
          <RefreshCw aria-hidden className="size-4" />Sync center
        </a>
        <a href="/collector/new" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-mo-line-strong px-4 font-medium text-mo-ink hover:bg-mo-hover">
          {bluetooth ? <Bluetooth aria-hidden className="size-4" /> : <Smartphone aria-hidden className="size-4" />}Connect a scale
        </a>
      </div>
    </SettingsCard>
  );
}

export default function CollectorSettingsPage() {
  const [options, setOptions] = useState<{ centres: WorkOption[]; coolers: WorkOption[] }>({ centres: [], coolers: [] });
  useEffect(() => {
    // From this phone's local copy when offline-capable, so preferences work without a connection.
    Promise.all([listCentres().catch(() => []), listCoolers().catch(() => [])]).then(([centres, coolers]) =>
      setOptions({
        centres: centres.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, name: c.name })),
        coolers: coolers.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, name: `${c.name} (${c.code})` })),
      }),
    );
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>
      <AccountSettings
        compact
        workOptions={options}
        sections={['profile', 'work', 'notifications', 'phone', 'password', 'mfa', 'sessions', 'activity']}
        after={<ThisDevice />}
      />
    </div>
  );
}
