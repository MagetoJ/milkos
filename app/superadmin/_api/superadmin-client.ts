import { clearSession, logout as authLogout } from '@/lib/auth';
import {
  SuperadminStats,
  CooperativeApplication,
  PaymentVerificationItem,
  SystemSettings,
  AuditLogItem,
} from "../_types/superadmin-types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1/superadmin";

const DEFAULT_FETCH_OPTIONS: RequestInit = {
  headers: {
    "Content-Type": "application/json",
  },
};

async function handleResponse(res: Response, message: string): Promise<Response> {
  if (res.status === 401 || res.status === 403) {
    clearSession();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
    throw new Error('Your session is invalid or no longer authorized. Please sign in again.');
  }

  if (!res.ok) {
    throw new Error(`${message} (${res.status})`);
  }

  return res;
}

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('milkflow_token');
  const headers = new Headers(options.headers ?? DEFAULT_FETCH_OPTIONS.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, {
    ...DEFAULT_FETCH_OPTIONS,
    ...options,
    headers,
  });
}

export async function fetchSuperadminStats(): Promise<SuperadminStats> {
  const res = await handleResponse(await authFetch(`${BASE_URL}/stats`), 'Failed to fetch stats');
  return res.json();
}

export async function fetchPendingApplications(): Promise<CooperativeApplication[]> {
  const res = await handleResponse(await authFetch(`${BASE_URL}/applications/pending`), 'Failed to fetch pending applications');
  return res.json();
}

export async function fetchPendingPayments(): Promise<PaymentVerificationItem[]> {
  const res = await handleResponse(await authFetch(`${BASE_URL}/payments/pending`), 'Failed to fetch pending payments');
  return res.json();
}

export async function processApplication(
  id: string,
  action: "APPROVE" | "REJECT"
): Promise<boolean> {
  const res = await authFetch(`${BASE_URL}/applications/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  await handleResponse(res, 'Failed to process application');
  return true;
}

export async function verifyPayment(
  id: string,
  action: "VERIFY" | "REJECT"
): Promise<boolean> {
  const res = await authFetch(`${BASE_URL}/payments/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  await handleResponse(res, 'Failed to process payment');
  return true;
}

export async function fetchSystemSettings(): Promise<SystemSettings> {
  const res = await handleResponse(await authFetch(`${BASE_URL}/settings`), 'Failed to fetch settings');
  return res.json();
}

export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<boolean> {
  const res = await authFetch(`${BASE_URL}/settings`, {
    method: "POST",
    body: JSON.stringify(settings),
  });
  await handleResponse(res, 'Failed to update settings');
  return true;
}

export async function fetchAuditLogs(): Promise<AuditLogItem[]> {
  const res = await handleResponse(await authFetch(`${BASE_URL}/audit-logs`), 'Failed to fetch audit logs');
  return res.json();
}

export async function performLogout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Ignore network error during logout
  } finally {
    authLogout();
  }
}