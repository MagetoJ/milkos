'use client';

// Connecting a cooler's sensor, recording a manual reading, and a cooler's reading history.
// Everything here goes through the SensorAdapter abstraction (lib/sensors) - never navigator.bluetooth.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bluetooth, FlaskConical, Info } from 'lucide-react';
import { ErrorBanner, Field, FormDialog, Modal, Muted, StatusBadge, inputClass, primaryButton, secondaryButton } from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { SyncPill } from '@/components/offline/status';
import { getBluetoothCapability, type BluetoothCapability } from '@/lib/bluetooth/capability';
import { isNativeBridgeAvailable } from '@/lib/bluetooth/native-bridge';
import { getProtocol } from '@/lib/bluetooth/protocols';
import { chooseBluetoothDevice, WebBluetoothSensorAdapter, type BTDevice } from '@/lib/bluetooth/web-bluetooth-adapter';
import { formatDateTime, formatLitres } from '@/lib/format';
import { useSubmit } from '@/lib/hooks/use-submit';
import { readingsFor } from '@/lib/offline/repositories';
import { sensorManager } from '@/lib/sensors/manager';
import { saveReading } from '@/lib/sensors/reading-service';
import { SimulatedSensorAdapter, simulatorEnabled } from '@/lib/sensors/simulated-adapter';
import type { CoolerSensorBinding, SensorDeviceInfo } from '@/lib/sensors/types';
import { useIsOnline, useLocalQuery } from '@/lib/sync/hooks';
import type { Cooler, CoolerReading, SensorDevice } from '@/app/superadmin/_types/platform-types';
import { registerSensor } from '../_api/coop-client';

function bindingFor(cooler: Cooler, sensor: SensorDevice | null): CoolerSensorBinding {
  return {
    cooler_id: cooler.id,
    sensor_id: sensor?.id ?? null,
    cooler_capacity_litres: cooler.capacity_litres,
    protocol: sensor?.protocol ?? null,
    calibration: sensor?.calibration ?? null,
  };
}

export function CoolerSensorPanel({ cooler, onClose }: { cooler: Cooler; onClose: () => void }) {
  const toast = useToast();
  const isOnline = useIsOnline();
  const live = useSyncExternalStore(sensorManager.subscribe, sensorManager.getSnapshot, sensorManager.getSnapshot)[cooler.id];
  const [capability, setCapability] = useState<BluetoothCapability | null>(null);
  const [device, setDevice] = useState<BTDevice | null>(null);
  const [info, setInfo] = useState<SensorDeviceInfo | null>(live?.info ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bound = (cooler.sensors ?? []).filter((s) => s.is_active);

  useEffect(() => {
    void getBluetoothCapability().then(setCapability);
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // The browser's chooser was dismissed: not an error worth showing.
      if (e instanceof Error && e.name === 'NotFoundError') return;
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const connectBluetooth = () =>
    run(async () => {
      const chosen = await chooseBluetoothDevice();
      setDevice(chosen);
      const registered = bound.find((s) => s.bluetooth_device_id === chosen.id || s.sensor_identifier === chosen.id) ?? null;
      const adapter = new WebBluetoothSensorAdapter(chosen, registered?.protocol ?? null, registered?.calibration ?? null);
      setInfo(await sensorManager.connect(bindingFor(cooler, registered), adapter));
    });

  const connectSimulator = () =>
    run(async () => {
      const simulated = bound.find((s) => s.transport === 'SIMULATED') ?? null;
      setInfo(await sensorManager.connect(bindingFor(cooler, simulated), new SimulatedSensorAdapter(cooler.capacity_litres)));
    });

  const register = () =>
    run(async () => {
      if (!device) return;
      await registerSensor({
        name: device.name || `Sensor ${device.id.slice(0, 6)}`,
        sensor_identifier: device.id,
        sensor_type: 'LEVEL_SENSOR',
        transport: 'BLUETOOTH_LE',
        bluetooth_device_id: device.id,
        bluetooth_name: device.name ?? null,
        protocol: info?.protocol ?? null,
        cooler_id: cooler.id,
      });
      toast('Sensor registered and bound to this cooler.');
    });

  const readNow = () =>
    run(async () => {
      const result = await sensorManager.readNow(cooler.id);
      if (!result) setError('The sensor returned nothing MilkOS can decode (no measurement protocol for this hardware yet).');
      else toast(result.duplicate ? 'Same reading as before; not stored twice.' : `Reading saved${result.status === 'synced' ? '' : ' · Pending sync'}.`);
    });

  const registeredDevice = device && bound.some((s) => s.bluetooth_device_id === device.id || s.sensor_identifier === device.id);

  return (
    <Modal title={`Sensor · ${cooler.name}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {bound.length > 0 ? (
          <p className="text-[#5E6B64]">
            Bound sensor{bound.length > 1 ? 's' : ''}: {bound.map((s) => `${s.name}${s.is_simulated ? ' (simulated)' : ''}`).join(', ')}
          </p>
        ) : (
          <p className="text-[#5E6B64]">No sensor is bound to this cooler yet.</p>
        )}

        {capability && !capability.supported && (
          <div className="flex gap-2 rounded-lg border border-[#DDE3DE] bg-[#F6F7F4] px-3 py-2 text-[#3C4A43]">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              {capability.reason}
              {isNativeBridgeAvailable() ? ' The MilkOS native app is available on this device.' : ''}
            </p>
          </div>
        )}
        {capability?.supported && capability.available === false && <ErrorBanner message={capability.reason ?? 'Bluetooth is unavailable.'} />}

        <div className="flex flex-wrap gap-2">
          {live?.state === 'connected' ? (
            <>
              <button className={primaryButton} onClick={readNow} disabled={busy}>Read now</button>
              <button className={secondaryButton} onClick={() => void sensorManager.disconnect(cooler.id)} disabled={busy}>Disconnect</button>
            </>
          ) : (
            <button className={primaryButton} onClick={connectBluetooth} disabled={busy || !capability?.supported}>
              <Bluetooth className="size-4" /> Scan for Bluetooth sensor
            </button>
          )}
          {simulatorEnabled() && live?.state !== 'connected' && (
            <button className={secondaryButton} onClick={connectSimulator} disabled={busy} title="Development only: produces made-up readings labelled SIMULATED">
              <FlaskConical className="size-4" /> Use simulator (test data)
            </button>
          )}
        </div>

        {live && (
          <p>
            Status: <StatusBadge status={live.state} tone={live.state === 'connected' ? 'green' : live.state === 'error' ? 'red' : 'grey'} />{' '}
            {live.transport === 'SIMULATED' && <StatusBadge status="SIMULATED" label="Simulated sensor" tone="blue" />}{' '}
            {live.lastReadingAt && <span className="text-[#5E6B64]">Last reading {formatDateTime(live.lastReadingAt)}</span>}
            {live.error && <span className="text-[#B42318]"> · {live.error}</span>}
          </p>
        )}

        {info && info.transport === 'BLUETOOTH_LE' && (
          <div className="space-y-2 rounded-lg border border-[#DDE3DE] px-3 py-2">
            <p className="font-medium">{info.name ?? 'Unnamed device'} <span className="font-normal text-[#8A968F]">({info.id.slice(0, 10)}…)</span></p>
            <p className="text-[#5E6B64]">Protocol: {getProtocol(info.protocol).label}</p>
            {!info.measures.volume && (
              <p className="rounded-md bg-[#FBF1DC] px-2 py-1.5 text-[#5C3D06]">
                MilkOS can&apos;t read litres from this sensor yet: its manufacturer&apos;s measurement protocol isn&apos;t configured.
                {info.measures.battery || info.measures.temperature
                  ? ` Standard Bluetooth ${[info.measures.temperature && 'temperature', info.measures.battery && 'battery'].filter(Boolean).join(' and ')} will be recorded.`
                  : ' It exposes no standard measurements either.'}
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-[#176044]">Services and characteristics ({info.services.length})</summary>
              {info.services.length === 0 ? (
                <p className="mt-1 text-xs text-[#5E6B64]">No known services are exposed. A protocol adapter must list this device&apos;s services before they can be read.</p>
              ) : (
                <ul className="mt-1 space-y-1 font-mono text-xs">
                  {info.services.map((s) => (
                    <li key={s.uuid}>
                      {s.uuid}
                      <ul className="pl-4 text-[#5E6B64]">
                        {s.characteristics.map((c) => <li key={c.uuid}>{c.uuid} [{c.properties.join(', ')}]</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            {device && !registeredDevice && (
              <button className={secondaryButton} onClick={register} disabled={busy || !isOnline} title={isOnline ? undefined : 'Registering a sensor needs a connection'}>
                Register and bind to {cooler.name}
              </button>
            )}
          </div>
        )}

        {error && <ErrorBanner message={error} />}
        <p className="text-xs text-[#8A968F]">
          Readings are saved on this device first and sync when online. Bluetooth only carries the data; litres come from the sensor&apos;s own measurement.
        </p>
      </div>
    </Modal>
  );
}

export function ManualReadingDialog({ cooler, onClose }: { cooler: Cooler; onClose: () => void }) {
  const toast = useToast();
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [litres, setLitres] = useState('');
  const [temp, setTemp] = useState('');
  async function submit() {
    let pending = false;
    const ok = await run(async () => {
      const result = await saveReading(
        { cooler_id: cooler.id, sensor_id: null, cooler_capacity_litres: cooler.capacity_litres, protocol: null, calibration: null },
        { volume_litres: litres.trim() ? Number(litres) : null, temperature_celsius: temp.trim() ? Number(temp) : null, measured_at: new Date().toISOString() },
        'MANUAL',
      );
      pending = result.status !== 'synced';
    });
    if (ok) {
      toast(`Reading saved${pending ? ' · Pending synchronization' : '.'}`);
      onClose();
    }
  }
  return (
    <FormDialog title={`Manual reading · ${cooler.name}`} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel="Save reading">
      <p className="text-sm text-[#5E6B64]">For a dipstick or gauge reading typed in by a person. It is stored as a manual reading.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Volume (litres)" required error={fieldErrors.volume_litres}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={litres} onChange={(e) => setLitres(e.target.value)} autoFocus />}
        </Field>
        <Field label="Temperature °C" error={fieldErrors.temperature_celsius}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={temp} onChange={(e) => setTemp(e.target.value)} />}
        </Field>
      </div>
    </FormDialog>
  );
}

export function ReadingHistory({ cooler, onClose }: { cooler: Cooler; onClose: () => void }) {
  const readings = useLocalQuery(() => readingsFor<CoolerReading>(cooler.id, 100), ['readings'], [cooler.id]);
  return (
    <Modal title={`Readings · ${cooler.name}`} onClose={onClose} wide>
      {(readings.data ?? []).length === 0 ? (
        <p className="text-sm text-[#5E6B64]">No readings on this device yet.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[#8A968F]">
              <tr>
                <th className="py-2 font-medium">Measured</th>
                <th className="py-2 text-right font-medium">Volume</th>
                <th className="py-2 text-right font-medium">Temp.</th>
                <th className="py-2 pl-3 font-medium">Source</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1EC]">
              {(readings.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-2">{formatDateTime(r.measured_at)}</td>
                  <td className="py-2 text-right tabular-nums">{r.volume_litres == null ? <Muted /> : formatLitres(r.volume_litres)}</td>
                  <td className="py-2 text-right tabular-nums">{r.temperature_celsius == null ? <Muted /> : `${r.temperature_celsius} °C`}</td>
                  <td className="py-2 pl-3">{r.source === 'SIMULATED' ? <StatusBadge status="SIMULATED" tone="blue" /> : r.source.toLowerCase()}</td>
                  <td className="py-2">
                    {r.sync_status && r.sync_status !== 'synced' ? (
                      <SyncPill status={r.sync_status} />
                    ) : r.quality === 'SUSPICIOUS' ? (
                      <span title={r.quality_flags.join(', ')}><StatusBadge status="SUSPICIOUS" tone="amber" /></span>
                    ) : (
                      'Synced'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
