import { SuperadminStats, CooperativeApplication, PaymentVerificationItem } from '../_types/superadmin-types';

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('milkflow_token') : '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchSuperadminStats(): Promise<SuperadminStats> {
  const res = await fetch('/api/v1/superadmin/stats', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch platform metrics');
  return res.json();
}

export async function fetchPendingApplications(): Promise<CooperativeApplication[]> {
  const res = await fetch('/api/v1/superadmin/applications/pending', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch onboarding queue');
  return res.json();
}

export async function fetchPendingPayments(): Promise<PaymentVerificationItem[]> {
  const res = await fetch('/api/v1/superadmin/payments/pending', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch M-Pesa verification queue');
  return res.json();
}

export async function verifyPayment(paymentId: string, action: 'VERIFY' | 'REJECT'): Promise<boolean> {
  const res = await fetch(`/api/v1/superadmin/payments/${paymentId}/action`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action }),
  });
  return res.ok;
}

export async function processApplication(appId: string, action: 'APPROVE' | 'REJECT'): Promise<boolean> {
  const res = await fetch(`/api/v1/superadmin/applications/${appId}/action`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action }),
  });
  return res.ok;
}