import { getSupabase } from './supabase/client';

export const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
  }
}

let activeCooperativeId: string | null = null;

/** Set by AuthProvider; sent as x-cooperative-id so tenant routes without an id in the path know which cooperative to use. */
export function setApiCooperative(id: string | null) {
  activeCooperativeId = id;
}

async function accessToken(forceRefresh = false): Promise<string | undefined> {
  const auth = getSupabase().auth;
  if (forceRefresh) {
    const { data } = await auth.refreshSession();
    return data.session?.access_token;
  }
  const { data } = await auth.getSession();
  return data.session?.access_token;
}

/** Raw fetch against the API with the caller's Supabase access token attached. */
export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token?: string) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (activeCooperativeId && !headers.has('x-cooperative-id')) headers.set('x-cooperative-id', activeCooperativeId);
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${apiUrl}${path}`, { ...init, headers });
  };

  let response = await send(await accessToken());
  // An expired token that the client has not refreshed yet: refresh once and retry.
  if (response.status === 401) {
    const refreshed = await accessToken(true);
    if (refreshed) response = await send(refreshed);
  }
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body?.code === 'MFA_REQUIRED' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('milkos:mfa-required'));
    }
  }
  return response;
}

/** JSON helper: throws ApiError with the API's message on non-2xx responses. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, init);
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  const code: string | undefined = body?.code;
  const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  const message = typeof raw === 'string' && raw
    ? raw
    : response.status === 401
      ? 'Your session has ended. Sign in again.'
      : response.status === 403
        ? 'You do not have permission to do this.'
        : `Request failed (${response.status}).`;
  return new ApiError(response.status, code, message);
}
