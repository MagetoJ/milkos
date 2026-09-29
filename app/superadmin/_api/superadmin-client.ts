import type {
  AuditEntry,
  CooperativeApplication,
  PaymentVerificationItem,
  SuperadminStats,
} from '../_types/superadmin-types';

// Relative URL: goes through the Next.js rewrite (same origin), so the HttpOnly cookie is sent.
const BASE_URL = '/api/v1/superadmin';
const LEGACY_TOKEN_KEY = 'milkflow_token';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Works with cookie auth and, if present, the localStorage bearer token. */
export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem(LEGACY_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init.headers },
  });

  if (res.status === 401) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, typeof detail === 'string' ? detail : `Request failed (HTTP ${res.status})`);
  }
  return body as T;
}

export const fetchSuperadminStats = () => request<SuperadminStats>('/stats');
export const fetchPendingApplications = () => request<CooperativeApplication[]>('/applications/pending');
export const fetchPendingPayments = () => request<PaymentVerificationItem[]>('/payments/pending');
export const fetchActivity = (limit = 20) => request<AuditEntry[]>(`/activity?limit=${limit}`);

export function processApplication(id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
  return request<{ success: boolean }>(`/applications/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  });
}

export function verifyPayment(id: string, action: 'VERIFY' | 'REJECT', reason?: string) {
  return request<{ success: boolean }>(`/payments/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  });
}
