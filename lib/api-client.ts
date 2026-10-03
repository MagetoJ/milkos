// Shared fetch wrapper for the MilkOS API.
// Relative URLs go through the Next.js rewrite (same origin), so the HttpOnly session cookie is sent;
// the bearer token from localStorage is added too. The backend is the authority on every permission:
// nothing here decides what a user may see or do.
import { TOKEN_KEY, clearSession, loginUrl } from '@/lib/auth';

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

export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ErrorItem {
  loc?: unknown[];
  msg?: string;
}

export function readError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return new ApiError(status, detail);

  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    let first: string | undefined;
    for (const item of detail as ErrorItem[]) {
      const loc = (item.loc ?? []).filter((part) => part !== 'body');
      // "admin.email" style names point at nested objects; keep the dotted path as the field key.
      const field = loc.length ? loc.map(String).join('.') : 'form';
      const message = item.msg ?? 'Invalid value.';
      fields[field] ??= message;
      const leaf = String(loc[loc.length - 1] ?? 'form');
      fields[leaf] ??= message;
      first ??= message;
    }
    return new ApiError(status, first ?? 'Please check the highlighted fields.', fields);
  }
  return new ApiError(status, `Request failed (HTTP ${status})`);
}

/** A request function bound to one API prefix, e.g. createApi('/api/v1/superadmin'). */
export function createApi(baseUrl: string) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
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

    if (res.status === 204) return undefined as T;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) throw readError(res.status, body);
    return body as T;
  };
}

export const send = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

/** ?a=1&b=x from an object, skipping empty values. */
export function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
