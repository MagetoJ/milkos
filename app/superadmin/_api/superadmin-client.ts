import { authHeaders, createApi, send, toQuery } from '@/lib/api-client';
import type {
  AuditEntry as LegacyAuditEntry,
  CooperativeApplication,
  PaymentVerificationItem,
} from '../_types/superadmin-types';
import type {
  AlertNotification,
  AuditEntry,
  Collection,
  CollectionSummary,
  CollectionsReport,
  Collector,
  CollectorInput,
  Cooler,
  CoolerInput,
  CoolerReading,
  Cooperative,
  CooperativeDetail,
  CooperativeInput,
  Dashboard,
  Device,
  Farmer,
  FarmerDetail,
  FarmerInput,
  Page,
  Payment,
  PaymentDetail,
  PaymentSummary,
  PlatformUser,
  PlatformUserDetail,
  RolesMatrix,
  SearchResult,
  SensorDevice,
  SyncHealth,
  Setting,
  SmsPackage,
  UserInput,
} from '../_types/platform-types';

export { ApiError } from '@/lib/api-client';
export { authHeaders };

const request = createApi('/api/v1/superadmin');

type Params = Record<string, string | number | boolean | null | undefined>;

// ---- dashboard, queue and search ----
export const fetchDashboard = () => request<Dashboard>('/dashboard');
export const fetchPendingApplications = () => request<CooperativeApplication[]>('/applications/pending');
export const fetchPendingPayments = () => request<PaymentVerificationItem[]>('/payments/pending');
export const fetchActivity = (limit = 20) => request<LegacyAuditEntry[]>(`/activity?limit=${limit}`);
export const globalSearch = (q: string) => request<{ query: string; results: SearchResult[] }>(`/search${toQuery({ q })}`);

export function processApplication(id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
  return request<{ success: boolean }>(`/applications/${id}/action`, send('POST', { action, reason }));
}

export function verifyPayment(id: string, action: 'VERIFY' | 'REJECT', reason?: string) {
  return request<{ success: boolean }>(`/payments/${id}/action`, send('POST', { action, reason }));
}

// ---- cooperatives ----
export const listCooperatives = (params: Params) => request<Page<Cooperative>>(`/cooperatives${toQuery(params)}`);
export const getCooperative = (id: string) => request<CooperativeDetail>(`/cooperatives/${id}`);
export const createCooperative = (data: CooperativeInput) => request<Cooperative>('/cooperatives', send('POST', data));
export const updateCooperative = (id: string, data: CooperativeInput) => request<Cooperative>(`/cooperatives/${id}`, send('PUT', data));
export const setCooperativeStatus = (id: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) =>
  request<Cooperative>(`/cooperatives/${id}/status`, send('PATCH', { status, reason }));
export interface SmsLedger {
  balances: { available: number; reserved: number; consumed: number; refunded: number; purchased: number; adjusted: number; balance: number };
  transactions: { id: string; transaction_type: string; amount: number; reference: string; reason: string | null; actor_email: string | null; created_at: string }[];
}
export const getSmsLedger = (id: string) => request<SmsLedger>(`/cooperatives/${id}/sms-ledger?limit=20`);

export const adjustSmsCredits = (id: string, delta: number, reason: string) =>
  request<Cooperative>(`/cooperatives/${id}/sms-credits`, send('POST', { delta, reason }));

/** Every cooperative as {id, name}, for filter dropdowns and "assign to" selects. */
export async function cooperativeOptions(): Promise<{ value: string; label: string }[]> {
  const out: { value: string; label: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await listCooperatives({ page, page_size: 100, sort: 'name' });
    out.push(...res.items.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })));
    if (page >= res.pages) break;
  }
  return out;
}

// ---- users ----
export const listUsers = (params: Params) => request<Page<PlatformUser>>(`/users${toQuery(params)}`);
export const getUser = (id: string) => request<PlatformUserDetail>(`/users/${id}`);
export const createUser = (data: UserInput) => request<PlatformUser>('/users', send('POST', data));
export const updateUser = (id: string, data: UserInput) => request<PlatformUser>(`/users/${id}`, send('PUT', data));
export const setUserActive = (id: string, is_active: boolean, reason?: string) =>
  request<PlatformUser>(`/users/${id}/status`, send('PATCH', { is_active, reason }));
export const resetUserPassword = (id: string, password: string) =>
  request<void>(`/users/${id}/reset-password`, send('POST', { password }));

// ---- farmers ----
export const listFarmers = (params: Params) => request<Page<Farmer>>(`/farmers${toQuery(params)}`);
export const getFarmer = (id: string) => request<FarmerDetail>(`/farmers/${id}`);
export const createFarmer = (data: FarmerInput) => request<Farmer>('/farmers', send('POST', data));
export const updateFarmer = (id: string, data: FarmerInput) => request<Farmer>(`/farmers/${id}`, send('PUT', data));
export const setFarmerStatus = (id: string, status: 'ACTIVE' | 'INACTIVE', reason?: string) =>
  request<Farmer>(`/farmers/${id}/status`, send('PATCH', { status, reason }));

// ---- collectors ----
export const listCollectors = (params: Params) => request<Page<Collector>>(`/collectors${toQuery(params)}`);
export const getCollector = (id: string) => request<Collector>(`/collectors/${id}`);
export const createCollector = (data: CollectorInput) => request<Collector>('/collectors', send('POST', data));
export const updateCollector = (id: string, data: CollectorInput) => request<Collector>(`/collectors/${id}`, send('PUT', data));
export const setCollectorStatus = (id: string, status: 'ACTIVE' | 'INACTIVE', reason?: string) =>
  request<Collector>(`/collectors/${id}/status`, send('PATCH', { status, reason }));

// ---- coolers ----
export const listCoolers = (params: Params) => request<Page<Cooler>>(`/coolers${toQuery(params)}`);
export const getCooler = (id: string) => request<Cooler>(`/coolers/${id}`);
export const createCooler = (data: CoolerInput) => request<Cooler>('/coolers', send('POST', data));
export const updateCooler = (id: string, data: CoolerInput) => request<Cooler>(`/coolers/${id}`, send('PUT', data));
export const setCoolerStatus = (id: string, status: 'ACTIVE' | 'INACTIVE', reason?: string) =>
  request<Cooler>(`/coolers/${id}/status`, send('PATCH', { status, reason }));

// ---- collections, payments, reports, audit ----
export const listCollections = (params: Params) =>
  request<Page<Collection> & { summary: CollectionSummary }>(`/collections${toQuery(params)}`);
export const getCollection = (id: string) => request<Collection>(`/collections/${id}`);
export const listPayments = (params: Params) => request<Page<Payment> & { summary: PaymentSummary }>(`/payments${toQuery(params)}`);
export const getPayment = (id: string) => request<PaymentDetail>(`/payments/${id}`);
export const collectionsReport = (params: Params) => request<CollectionsReport>(`/reports/collections${toQuery(params)}`);
export const listAuditLogs = (params: Params) => request<Page<AuditEntry> & { actions: string[] }>(`/audit-logs${toQuery(params)}`);

// ---- settings ----
export const getSettings = () => request<Setting[]>('/settings');
export const saveSettings = (values: Record<string, unknown>) => request<Setting[]>('/settings', send('PUT', { values }));
export const getRoles = () => request<RolesMatrix>('/roles');
export const listSmsPackages = () => request<SmsPackage[]>('/sms-packages');
export const createSmsPackage = (data: Omit<SmsPackage, 'id'>) => request<SmsPackage>('/sms-packages', send('POST', data));
export const updateSmsPackage = (id: string, data: Partial<Omit<SmsPackage, 'id'>>) =>
  request<SmsPackage>(`/sms-packages/${id}`, send('PUT', data));

// ---- offline sync: health, devices, sensors, cooler readings, notifications ----
export const getSyncHealth = () => request<SyncHealth>('/sync/health');
export const listDevices = (params: Params) => request<Page<Device>>(`/sync/devices${toQuery(params)}`);
export const updateDevice = (id: string, data: { is_active?: boolean; label?: string }, release = false) =>
  request<Device>(`/sync/devices/${id}${release ? '?release=true' : ''}`, send('PATCH', data));
export const listSensorDevices = (params: Params) => request<Page<SensorDevice>>(`/sensors${toQuery(params)}`);
export const listCoolerReadings = (params: Params) => request<Page<CoolerReading>>(`/cooler-readings${toQuery(params)}`);
export const listNotifications = (params: Params) => request<Page<AlertNotification>>(`/notifications${toQuery(params)}`);
