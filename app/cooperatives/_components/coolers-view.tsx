'use client';

// Cooler monitoring: level, temperature, battery and sensor state per cooler, from this device's data
// (so it keeps working offline). A reading is only called "live" when it is less than 2 minutes old.
import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Bluetooth, Gauge, History, PenLine, Scale, Users } from 'lucide-react';
import { EmptyState, Muted, PageHeader, StatusBadge, secondaryButton } from '@/components/admin';
import { LocalDataNote, SyncPill } from '@/components/offline/status';
import { formatDateTime, formatLitres, formatNumber } from '@/lib/format';
import { latestReadingFor, recentNotifications } from '@/lib/offline/repositories';
import { sensorManager, type LiveSensor } from '@/lib/sensors/manager';
import { useIsOnline, useLocalQuery, useNow, useReloadOn, useRelativeTime } from '@/lib/sync/hooks';
import { useResource } from '@/lib/hooks/use-resource';
import type { AlertNotification, Cooler, CoolerReading } from '@/app/superadmin/_types/platform-types';
import { listCoolers } from '../_api/coop-client';
import { CoolerSensorPanel, ManualReadingDialog, ReadingHistory } from './cooler-sensor-panel';

const LIVE_MS = 2 * 60_000;

export function CoolersView() {
  const coolers = useResource(listCoolers, []);
  useReloadOn(['coolers', 'readings', 'sensors'], coolers.reload);
  const alerts = useLocalQuery(() => recentNotifications<AlertNotification>(8), ['notifications']);
  const live = useSyncExternalStore(sensorManager.subscribe, sensorManager.getSnapshot, sensorManager.getSnapshot);
  const isOnline = useIsOnline();
  const [panel, setPanel] = useState<{ cooler: Cooler; mode: 'sensor' | 'manual' | 'history' } | null>(null);

  const active = (coolers.data ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <>
      <PageHeader title="Cooler monitoring" subtitle="Milk level, temperature and sensor status of each cooler." />
      {!isOnline && <div className="-mt-3 mb-4"><LocalDataNote show /></div>}

      {coolers.data && active.length === 0 ? (
        <EmptyState icon={<Gauge className="size-8" />} title="No coolers yet" body="Add coolers on the Field operations page." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((c) => (
            <CoolerCard key={c.id} cooler={c} live={live[c.id]} onOpen={(mode) => setPanel({ cooler: c, mode })} />
          ))}
        </div>
      )}

      <section className="mt-8 rounded-xl border border-[#DDE3DE] bg-white">
        <h2 className="px-5 pb-2 pt-5 text-base font-semibold">Recent cooler alerts</h2>
        {(alerts.data ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[#5E6B64]">No alerts. Set thresholds on a cooler (Field operations → Edit) to be alerted by SMS.</p>
        ) : (
          <ul className="divide-y divide-[#EEF1EC]">
            {(alerts.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{String((a.context as { cooler?: { name?: string } } | null)?.cooler?.name ?? 'Cooler')}</span>{' '}
                  <span className="text-[#5E6B64]">{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[#8A968F]">
                  {formatDateTime(a.created_at)}
                  <StatusBadge status={a.status} tone={a.status === 'SENT' ? 'green' : a.status === 'FAILED' ? 'red' : a.status === 'SKIPPED' ? 'grey' : 'amber'} label={a.status === 'SENT' ? 'SMS sent' : a.status === 'FAILED' ? 'SMS failed' : a.status === 'SKIPPED' ? 'Not sent' : 'SMS pending'} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {panel?.mode === 'sensor' && <CoolerSensorPanel cooler={panel.cooler} onClose={() => setPanel(null)} />}
      {panel?.mode === 'manual' && <ManualReadingDialog cooler={panel.cooler} onClose={() => setPanel(null)} />}
      {panel?.mode === 'history' && <ReadingHistory cooler={panel.cooler} onClose={() => setPanel(null)} />}
    </>
  );
}

function CoolerCard({ cooler, live, onOpen }: { cooler: Cooler; live?: LiveSensor; onOpen: (mode: 'sensor' | 'manual' | 'history') => void }) {
  const latest = useLocalQuery(() => latestReadingFor<CoolerReading>(cooler.id), ['readings'], [cooler.id]);
  const reading = latest.data;
  // Prefer the newest of: the latest reading on this device, the cooler's server-side level.
  const useReading = reading && (!cooler.last_reading_at || reading.measured_at >= cooler.last_reading_at) && reading.quality !== 'SUSPICIOUS';
  const volume = useReading ? reading.volume_litres : (cooler.current_volume_litres ?? null);
  const at = useReading ? reading.measured_at : cooler.last_reading_at;
  const ago = useRelativeTime(at);
  const capacity = cooler.capacity_litres;
  const percent = volume != null && capacity ? Math.min(100, (volume / capacity) * 100) : null;
  const now = useNow(15_000);
  const isLive = !!at && now - Date.parse(at) < LIVE_MS && live?.state === 'connected';
  const simulated = reading?.source === 'SIMULATED' && useReading;
  const low = cooler.low_volume_alert_litres != null && volume != null && volume < cooler.low_volume_alert_litres;
  const high = cooler.high_volume_alert_litres != null && volume != null && volume > cooler.high_volume_alert_litres;

  const sensorLabel = live
    ? { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Error' }[live.state]
    : cooler.sensors?.length
      ? 'Not connected on this device'
      : 'No sensor bound';

  return (
    <article className="flex flex-col rounded-xl border border-[#DDE3DE] bg-white">
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{cooler.name}</h3>
          <p className="truncate text-sm text-[#5E6B64]">{cooler.centre_name ?? cooler.location ?? <Muted>No location</Muted>}</p>
          <p className="text-xs text-[#8A968F]">Manager: {cooler.manager_name ?? 'not assigned'}</p>
        </div>
        {cooler.is_operational ? <StatusBadge status="ONLINE" label="Operational" /> : <StatusBadge status="OFFLINE" label="Not operational" />}
      </header>

      <div className="px-5 pt-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {volume != null ? formatLitres(volume) : '– L'}
          <span className="text-base font-normal text-[#8A968F]"> / {capacity ? formatLitres(capacity) : 'capacity unknown'}</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EEF1EC]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-label="Percentage full">
          <div className={`h-full rounded-full ${low || high ? 'bg-[#D9822B]' : 'bg-[#176044]'}`} style={{ width: `${percent ?? 0}%` }} />
        </div>
        <p className="mt-1 text-sm text-[#5E6B64]">
          {percent != null ? `${percent.toFixed(1)}% full` : 'Level unknown'}
          {low && <span className="font-medium text-[#9A5B00]"> · below alert level</span>}
          {high && <span className="font-medium text-[#9A5B00]"> · above alert level</span>}
          {simulated && <span className="font-medium text-[#1F4E86]"> · simulated</span>}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#EEF1EC] px-5 py-4 text-sm">
        <dt className="text-[#5E6B64]">Sensor</dt>
        <dd className="flex items-center gap-1.5">
          <Bluetooth aria-hidden className="size-3.5 text-[#8A968F]" /> {sensorLabel}
        </dd>
        <dt className="text-[#5E6B64]">Last reading</dt>
        <dd>
          {at ? (
            <span title={formatDateTime(at)}>
              {isLive ? <span className="font-medium text-[#176044]">Live · </span> : null}
              {formatDateTime(at)} <span className="text-xs text-[#8A968F]">({ago})</span>
            </span>
          ) : (
            <Muted>None yet</Muted>
          )}
        </dd>
        <dt className="text-[#5E6B64]">Sync</dt>
        <dd>{reading && reading.sync_status && reading.sync_status !== 'synced' ? <SyncPill status={reading.sync_status} /> : at ? 'Synced' : <Muted />}</dd>
        <dt className="text-[#5E6B64]">Temperature</dt>
        <dd>{(useReading ? reading?.temperature_celsius : cooler.last_temperature_c) != null ? `${useReading ? reading?.temperature_celsius : cooler.last_temperature_c} °C` : <Muted />}</dd>
        <dt className="text-[#5E6B64]">Battery</dt>
        <dd>{reading?.battery_percent != null ? `${formatNumber(reading.battery_percent)}%` : cooler.battery_percent != null ? `${formatNumber(cooler.battery_percent)}%` : <Muted />}</dd>
        <dt className="text-[#5E6B64]">Sensor status</dt>
        <dd>{cooler.sensor_status ? cooler.sensor_status.charAt(0) + cooler.sensor_status.slice(1).toLowerCase() : <Muted>No sensor</Muted>}</dd>
        <dt className="text-[#5E6B64]">Last seen</dt>
        <dd>{cooler.last_seen_at ? formatDateTime(cooler.last_seen_at) : <Muted>Never</Muted>}</dd>
      </dl>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#EEF1EC] px-5 py-4 text-sm">
        <dt className="text-[#5E6B64]">Milk today</dt>
        <dd className="tabular-nums">{cooler.kg_today != null ? `${formatNumber(cooler.kg_today)} KG · ${formatNumber(cooler.collections_today ?? 0)} collections` : <Muted />}</dd>
        <dt className="flex items-center gap-1 text-[#5E6B64]"><Users aria-hidden className="size-3.5" /> Collectors</dt>
        <dd>{formatNumber(cooler.collector_count ?? 0)}</dd>
        <dt className="flex items-center gap-1 text-[#5E6B64]"><Scale aria-hidden className="size-3.5" /> Scale</dt>
        <dd>
          {cooler.scale
            ? `${cooler.scale.source === 'MANUAL' ? 'Manual entry' : cooler.scale.source === 'SIMULATED' ? 'Simulator' : cooler.scale.source === 'LITRES' ? 'Litres entry' : cooler.scale.name ?? 'Scale'} · ${formatDateTime(cooler.scale.last_used_at)}`
            : cooler.scale_device_id ?? <Muted>Not used yet</Muted>}
        </dd>
        <dt className="flex items-center gap-1 text-[#5E6B64]"><AlertTriangle aria-hidden className="size-3.5" /> Alerts (24 h)</dt>
        <dd className={cooler.alerts_24h ? 'font-medium text-[#9A5B00]' : ''}>{formatNumber(cooler.alerts_24h ?? 0)}</dd>
      </dl>

      <footer className="mt-auto flex flex-wrap gap-2 border-t border-[#EEF1EC] px-5 py-3">
        <button className={secondaryButton} onClick={() => onOpen('sensor')}>
          <Bluetooth className="size-4" /> Sensor
        </button>
        <button className={secondaryButton} onClick={() => onOpen('manual')}>
          <PenLine className="size-4" /> Manual reading
        </button>
        <button className={secondaryButton} onClick={() => onOpen('history')}>
          <History className="size-4" /> History
        </button>
      </footer>
    </article>
  );
}
