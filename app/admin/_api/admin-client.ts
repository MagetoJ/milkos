import { AdminStats, CooperativeApplication, PaymentVerificationItem } from '../_types/admin-types';

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('milkflow_token') : '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch('/api/v1/admin/stats', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch admin stats');
  return res.json();
}

export async function fetchPendingApplications(): Promise<CooperativeApplication[]> {
  const res = await fetch('/api/v1/admin/applications/pending', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch applications');
  return res.json();
}

export async function fetchPendingPayments(): Promise<PaymentVerificationItem[]> {
  const res = await fetch('/api/v1/admin/payments/pending', { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to fetch payments');
  return res.json();
}

export async function verifyPayment(paymentId: string, action: 'VERIFY' | 'REJECT'): Promise<boolean> {
  const res = await fetch(`/api/v1/admin/payments/${paymentId}/action`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action }),
  });
  return res.ok;
}

export async function processApplication(appId: string, action: 'APPROVE' | 'REJECT'): Promise<boolean> {
  const res = await fetch(`/api/v1/admin/applications/${appId}/action`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action }),
  });
  return res.ok;
}