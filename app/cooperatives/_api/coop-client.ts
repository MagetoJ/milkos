// Cooperative workspace data, offline-first. Function names and return types are unchanged; what changed
// is where the data comes from:
//
//   operational lists (farmers, centres, coolers, collectors, team)
//                       the device's local database, kept current by the sync engine. Before the first
//                       download finishes (or without an offline session) they come from the server.
//   farmers, centres    created/edited through the sync queue: instant locally, pushed at once when
//                       online (server errors still reach the form), queued when offline.
//   overview            the server when reachable; otherwise computed from local data (marked offline).
//   team, coolers, collector assignments, sensors, devices
//                       server-authoritative: changed online only, then copied into the local database.
import { ApiError, createApi, NEEDS_CONNECTION, send } from '@/lib/api-client';
import { isServerReachable } from '@/lib/offline/connectivity';
import { hasUserDb, userDb } from '@/lib/offline/db';
import { saveChange } from '@/lib/offline/mutations';
import { getRawRow, initialSyncDone, listAll, listFarmers as listLocalFarmers, publicRow, readingsFor } from '@/lib/offline/repositories';
import { validateCentre, validateFarmer } from '@/lib/offline/validation';
import { uuid } from '@/lib/offline/ids';
import type { PulledEntity } from '@/lib/offline/types';
import { applyPulled } from '@/lib/sync/apply';
import { pendingMutationIdsFor } from '@/lib/sync/queue';
import type {
  Centre,
  CentreInput,
  Farmer,
  FarmerInput,
  FarmerPage,
  FarmerQuery,
  Overview,
  TeamCreateInput,
  TeamMember,
  TeamUpdateInput,
} from '../_types/coop-types';
import type {
  AlertNotification,
  Collector,
  CollectorInput,
  Cooler,
  CoolerInput,
  CoolerReading,
  Device,
  SensorDevice,
} from '@/app/superadmin/_types/platform-types';
import { localOverview } from '../_lib/local-overview';

export { ApiError };

const request = createApi('/api/v1/cooperative');

/** Local data can answer once this device holds an offline session and finished its first download. */
async function localReady(): Promise<boolean> {
  return hasUserDb() && (await initialSyncDone());
}

/** Prefer local data; fall back to the server (and back to local again if the server is unreachable). */
async function localFirst<T>(local: () => Promise<T>, online: () => Promise<T>): Promise<T> {
  if (await localReady()) return local();
  return online();
}

/** Prefer the server; use local data when it can't be reached. */
async function serverFirst<T>(online: () => Promise<T>, local: () => Promise<T>): Promise<T> {
  if (!isServerReachable() && (await localReady())) return local();
  try {
    return await online();
  } catch (e) {
    if (e instanceof ApiError && e.status === 0 && (await localReady())) return local();
    throw e;
  }
}

/** A server-authoritative change: needs a connection; its result is copied into the local database. */
async function onlineOnly<T extends { id: string }>(entity: PulledEntity | null, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call();
    if (entity && hasUserDb()) {
      await applyPulled(userDb(), [{ seq: 0, entity_type: entity, entity_id: result.id, op: 'upsert', data: result as never }]);
    }
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) throw new ApiError(0, NEEDS_CONNECTION);
    throw e;
  }
}

const byName = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.name ?? '').localeCompare(String(b.name ?? ''));

// ---------------- overview ----------------

export const getOverview = () => serverFirst(() => request<Overview>('/overview'), localOverview);

// ---------------- collection centres ----------------

export const listCentres = () =>
  localFirst(() => listAll<Centre>('centres', byName), () => request<Centre[]>('/centres'));

export async function createCentre(data: CentreInput): Promise<Centre> {
  if (!hasUserDb()) return request<Centre>('/centres', send('POST', data));
  const clean = validateCentre(data, true);
  const id = uuid();
  const coop = (await userDb().cooperative.toCollection().first()) as Record<string, unknown> | undefined;
  const payload = { ...data, ...clean };
  const { record } = await saveChange<Centre>({
    mutation: { entity_type: 'centre', operation: 'create', local_id: id, table: 'centres', payload: payload as Record<string, unknown> },
    table: 'centres',
    entity: 'centre',
    interactive: true,
    optimistic: {
      id,
      name: clean.name ?? '',
      code: clean.code ?? 'Pending',
      county: data.county ?? (coop?.county as string) ?? '',
      location_description: data.location_description ?? null,
      manager_user_id: data.manager_user_id ?? null,
      manager_name: null,
      has_cooler: !!data.has_cooler,
      cooler_capacity_litres: data.has_cooler ? (data.cooler_capacity_litres ?? null) : null,
      status: 'ACTIVE',
      farmer_count: 0,
      created_at: new Date().toISOString(),
    },
  });
  return record;
}

export async function updateCentre(id: string, data: CentreInput): Promise<Centre> {
  if (!hasUserDb()) return request<Centre>(`/centres/${id}`, send('PATCH', data));
  const row = await getRawRow('centres', id);
  if (!row) return request<Centre>(`/centres/${id}`, send('PATCH', data));
  const clean = { ...data, ...validateCentre(data, false) };
  const current = publicRow<Centre>(row);
  const base = Object.fromEntries(Object.keys(clean).map((k) => [k, (current as unknown as Record<string, unknown>)[k] ?? null]));
  const { record } = await saveChange<Centre>({
    mutation: {
      entity_type: 'centre', operation: 'update', local_id: id, table: 'centres', payload: clean as Record<string, unknown>,
      base_version: (row.sync_version as number | undefined) ?? null, base,
      depends_on: await pendingMutationIdsFor(userDb(), [id]),
      previous: row,
    },
    table: 'centres',
    entity: 'centre',
    interactive: true,
    optimistic: { ...stripPublic(current), ...clean, id, ...(clean.has_cooler === false ? { cooler_capacity_litres: null } : {}) },
  });
  return record;
}

// ---------------- farmers ----------------

export function listFarmers(q: FarmerQuery) {
  return localFirst(
    () => listLocalFarmers<Farmer>({ search: q.search, centre: q.centre, status: q.status, page: q.page, pageSize: q.pageSize }),
    () => {
      const params = new URLSearchParams({ page: String(q.page), page_size: String(q.pageSize) });
      if (q.search?.trim()) params.set('search', q.search.trim());
      if (q.centre) params.set('centre_id', q.centre);
      if (q.status) params.set('status', q.status);
      return request<FarmerPage>(`/farmers?${params}`);
    },
  );
}

async function centreName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const centre = await getRawRow('centres', id);
  return (centre?.name as string | undefined) ?? null;
}

/** Drop the UI-only sync fields before a record goes back into the local database. */
function stripPublic<T>(value: T): Record<string, unknown> {
  const { sync_status: _s, sync_error: _e, ...rest } = value as unknown as Record<string, unknown>;
  void _s;
  void _e;
  return rest;
}

export async function createFarmer(data: FarmerInput): Promise<Farmer> {
  if (!hasUserDb()) return request<Farmer>('/farmers', send('POST', data));
  const clean = validateFarmer(data, true);
  const id = uuid();
  const now = new Date().toISOString();
  const { record } = await saveChange<Farmer>({
    mutation: {
      entity_type: 'farmer', operation: 'create', local_id: id, table: 'farmers',
      payload: { ...data, ...clean } as Record<string, unknown>,
      // A farmer for an offline-created centre waits for that centre.
      depends_on: await pendingMutationIdsFor(userDb(), [clean.centre_id]),
    },
    table: 'farmers',
    entity: 'farmer',
    interactive: true,
    optimistic: {
      id,
      farmer_number: clean.farmer_number ?? 'Pending',
      first_name: clean.first_name ?? '',
      last_name: clean.last_name ?? '',
      full_name: `${clean.first_name} ${clean.last_name}`,
      phone: clean.phone ?? '',
      national_id: clean.national_id ?? null,
      village: clean.village ?? null,
      status: 'ACTIVE',
      centre_id: clean.centre_id ?? null,
      centre_name: await centreName(clean.centre_id),
      has_account: false,
      created_at: now,
      updated_at: now,
    },
  });
  return record;
}

export async function updateFarmer(id: string, data: FarmerInput): Promise<Farmer> {
  if (!hasUserDb()) return request<Farmer>(`/farmers/${id}`, send('PATCH', data));
  const row = await getRawRow('farmers', id);
  if (!row) return request<Farmer>(`/farmers/${id}`, send('PATCH', data));
  const clean = { ...data, ...validateFarmer(data, false) };
  const current = publicRow<Farmer>(row);
  const base = Object.fromEntries(Object.keys(clean).map((k) => [k, (current as unknown as Record<string, unknown>)[k] ?? null]));
  const merged = { ...stripPublic(current), ...clean };
  const { record } = await saveChange<Farmer>({
    mutation: {
      entity_type: 'farmer', operation: 'update', local_id: id, table: 'farmers', payload: clean as Record<string, unknown>,
      base_version: (row.sync_version as number | undefined) ?? null, base,
      depends_on: await pendingMutationIdsFor(userDb(), [id, clean.centre_id]),
      previous: row,
    },
    table: 'farmers',
    entity: 'farmer',
    interactive: true,
    optimistic: {
      ...merged,
      id,
      full_name: `${merged.first_name} ${merged.last_name}`,
      centre_name: 'centre_id' in clean ? await centreName(clean.centre_id) : (merged as Record<string, unknown>).centre_name,
      updated_at: new Date().toISOString(),
    },
  });
  return record;
}

// ---------------- team (server-authoritative) ----------------

const ROLE_ORDER: Record<string, number> = { COOP_ADMIN: 0, MANAGER: 1, COLLECTOR: 2 };

export const listTeam = () =>
  localFirst(
    () =>
      listAll<TeamMember>('team', (a, b) =>
        (ROLE_ORDER[String(a.role)] ?? 9) - (ROLE_ORDER[String(b.role)] ?? 9) ||
        String(a.full_name).toLowerCase().localeCompare(String(b.full_name).toLowerCase()),
      ),
    () => request<TeamMember[]>('/team'),
  );
export const createMember = (data: TeamCreateInput) => onlineOnly('team_member', () => request<TeamMember>('/team', send('POST', data)));
export const updateMember = (id: string, data: TeamUpdateInput) =>
  onlineOnly('team_member', () => request<TeamMember>(`/team/${id}`, send('PATCH', data)));

// ---------------- field operations: coolers and collector assignments ----------------

export const listCoolers = () =>
  localFirst(
    () => listAll<Cooler>('coolers', (a, b) => String(a.status).localeCompare(String(b.status)) || String(a.code).localeCompare(String(b.code))),
    () => request<Cooler[]>('/coolers'),
  );
export const createCooler = (data: CoolerInput) => onlineOnly('cooler', () => request<Cooler>('/coolers', send('POST', data)));
export const updateCooler = (id: string, data: CoolerInput) => onlineOnly('cooler', () => request<Cooler>(`/coolers/${id}`, send('PATCH', data)));
export const listCollectors = () =>
  localFirst(() => listAll<Collector>('collectors', (a, b) => String(a.full_name).localeCompare(String(b.full_name))), () => request<Collector[]>('/collectors'));
export const updateCollector = (id: string, data: CollectorInput) =>
  onlineOnly('collector', () => request<Collector>(`/collectors/${id}`, send('PATCH', data)));

// ---------------- cooler monitoring ----------------

export const listSensors = () => localFirst(() => listAll<SensorDevice>('sensors', byName), () => request<SensorDevice[]>('/sensors'));
export const registerSensor = (data: Record<string, unknown>) => onlineOnly('sensor', () => request<SensorDevice>('/sensors', send('POST', data)));
export const updateSensor = (id: string, data: Record<string, unknown>) =>
  onlineOnly('sensor', () => request<SensorDevice>(`/sensors/${id}`, send('PATCH', data)));
export const listCoolerReadings = (coolerId: string, limit = 50) =>
  localFirst(() => readingsFor<CoolerReading>(coolerId, limit), () => request<CoolerReading[]>(`/coolers/${coolerId}/readings?limit=${limit}`));
export const listNotifications = () => request<{ items: AlertNotification[]; total: number }>('/notifications?page_size=50');
export const retryNotification = (id: string) =>
  onlineOnly('notification', () => request<AlertNotification>(`/notifications/${id}/retry`, send('POST')));
export const checkAlerts = () => request<{ created: number }>('/coolers/alerts/check', send('POST'));

// ---------------- devices ----------------

export const listDevices = () => request<Device[]>('/devices');
export const updateDevice = (id: string, data: { is_active?: boolean; label?: string }) =>
  onlineOnly(null, () => request<Device>(`/devices/${id}`, send('PATCH', data)));
