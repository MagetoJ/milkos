import {
  SuperadminStats,
  CooperativeApplication,
  PaymentVerificationItem,
} from "../_types/superadmin-types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1/superadmin";

const DEFAULT_FETCH_OPTIONS: RequestInit = {
  credentials: "include", // Automatically sends HttpOnly cookies with the request
  headers: {
    "Content-Type": "application/json",
  },
};

export async function fetchSuperadminStats(): Promise<SuperadminStats> {
  const res = await fetch(`${BASE_URL}/stats`, DEFAULT_FETCH_OPTIONS);
  if (!res.ok) throw new Error(`Failed to fetch stats (${res.status})`);
  return res.json();
}

export async function fetchPendingApplications(): Promise<CooperativeApplication[]> {
  const res = await fetch(`${BASE_URL}/applications/pending`, DEFAULT_FETCH_OPTIONS);
  if (!res.ok) throw new Error(`Failed to fetch pending applications (${res.status})`);
  return res.json();
}

export async function fetchPendingPayments(): Promise<PaymentVerificationItem[]> {
  const res = await fetch(`${BASE_URL}/payments/pending`, DEFAULT_FETCH_OPTIONS);
  if (!res.ok) throw new Error(`Failed to fetch pending payments (${res.status})`);
  return res.json();
}

export async function processApplication(
  id: string,
  action: "APPROVE" | "REJECT"
): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/applications/${id}/action`, {
    ...DEFAULT_FETCH_OPTIONS,
    method: "POST",
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Failed to process application (${res.status})`);
  return true;
}

export async function verifyPayment(
  id: string,
  action: "VERIFY" | "REJECT"
): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/payments/${id}/action`, {
    ...DEFAULT_FETCH_OPTIONS,
    method: "POST",
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Failed to process payment (${res.status})`);
  return true;
}