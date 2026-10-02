import { TOKEN_KEY, clearSession, loginUrl } from '@/lib/auth';
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

// Relative URL: goes through the Next.js rewrite (same origin), so the session cookie is sent too.
const BASE_URL = '/api/v1/cooperative';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Messages keyed by the request field they belong to (from 422 and 409 responses). */
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ErrorItem {
  loc?: unknown[];
  msg?: string;
}

function readError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return new ApiError(status, detail);

  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    let first: string | undefined;
    for (const item of detail as ErrorItem[]) {
      const field = String(item.loc?.[item.loc.length - 1] ?? 'form');
      const message = item.msg ?? 'Invalid value.';
      fields[field] ??= message;
      first ??= message;
    }
    return new ApiError(status, first ?? 'Please check the highlighted fields.', fields);
  }
  return new ApiError(status, `Request failed (HTTP ${status})`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401) {
    clearSession();
    window.location.replace(loginUrl(window.location.pathname));
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw readError(res.status, body);
  return body as T;
}

const send = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

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