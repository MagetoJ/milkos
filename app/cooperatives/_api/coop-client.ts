import { ApiError, createApi, send } from '@/lib/api-client';
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
import type { Collector, CollectorInput, Cooler, CoolerInput } from '@/app/superadmin/_types/platform-types';

export { ApiError };

const request = createApi('/api/v1/cooperative');

export const getOverview = () => request<Overview>('/overview');

export const listCentres = () => request<Centre[]>('/centres');
export const createCentre = (data: CentreInput) => request<Centre>('/centres', send('POST', data));
export const updateCentre = (id: string, data: CentreInput) => request<Centre>(`/centres/${id}`, send('PATCH', data));

export function listFarmers(q: FarmerQuery) {
  const params = new URLSearchParams({ page: String(q.page), page_size: String(q.pageSize) });
  if (q.search?.trim()) params.set('search', q.search.trim());
  if (q.centre) params.set('centre_id', q.centre);
  if (q.status) params.set('status', q.status);
  return request<FarmerPage>(`/farmers?${params}`);
}
export const createFarmer = (data: FarmerInput) => request<Farmer>('/farmers', send('POST', data));
export const updateFarmer = (id: string, data: FarmerInput) => request<Farmer>(`/farmers/${id}`, send('PATCH', data));

export const listTeam = () => request<TeamMember[]>('/team');
export const createMember = (data: TeamCreateInput) => request<TeamMember>('/team', send('POST', data));
export const updateMember = (id: string, data: TeamUpdateInput) => request<TeamMember>(`/team/${id}`, send('PATCH', data));
// ---- field operations: coolers and collector assignments ----
export const listCoolers = () => request<Cooler[]>('/coolers');
export const createCooler = (data: CoolerInput) => request<Cooler>('/coolers', send('POST', data));
export const updateCooler = (id: string, data: CoolerInput) => request<Cooler>(`/coolers/${id}`, send('PATCH', data));
export const listCollectors = () => request<Collector[]>('/collectors');
export const updateCollector = (id: string, data: CollectorInput) => request<Collector>(`/collectors/${id}`, send('PATCH', data));
