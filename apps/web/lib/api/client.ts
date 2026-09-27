import { createClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { getActiveCooperativeId } from '@/lib/auth/active-cooperative';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

interface AuthFetchInit extends RequestInit {
  /** Override the tenant header; null sends none. Defaults to the active cooperative. */
  cooperativeId?: string | null;
}

/**
 * fetch() against the Milkos API with the Supabase access token and active
 * cooperative attached. Returns the raw Response for callers that stream CSVs
 * or handle status codes themselves.
 */
export async function authFetch(path: string, { cooperativeId, headers, ...init }: AuthFetchInit = {}): Promise<Response> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const merged = new Headers(headers);
  if (token) merged.set('authorization', `Bearer ${token}`);
  if (init.body && !merged.has('content-type') && typeof init.body === 'string') merged.set('content-type', 'application/json');
  const tenant = cooperativeId === undefined ? getActiveCooperativeId() : cooperativeId;
  if (tenant) merged.set('x-cooperative-id', tenant);

  // Relative paths only, so the bearer token can never be sent to another host.
  const url = `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, { ...init, headers: merged });

  if (response.status === 403 && typeof window !== 'undefined') {
    const body = await response.clone().json().catch(() => null);
    if (body?.code === 'MFA_REQUIRED' && !window.location.pathname.startsWith('/auth/mfa')) {
      window.location.assign(`/auth/mfa?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }
  return response;
}

/** JSON helper: throws ApiError with the API's message/code on non-2xx. */
export async function apiFetch<T>(path: string, init: AuthFetchInit = {}): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message || response.statusText || 'Request failed';
    throw new ApiError(response.status, message, body?.code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
