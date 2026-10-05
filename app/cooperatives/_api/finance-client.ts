// Server-authoritative cooperative modules: SMS Credit Center, milk pricing, farmer payments, notification
// center, reports and search. All of these need a connection (balances, prices and payments are decided by
// the server and never edited on a device).
import { createApi, send, toQuery } from '@/lib/api-client';

const coop = createApi('/api/v1/cooperative');
const inboxApi = createApi('/api/v1/inbox');
const reportsApi = createApi('/api/v1/reports');
const searchApi = createApi('/api/v1/search');

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// ---------------- SMS credits ----------------

export interface CreditBalances {
  available: number;
  reserved: number;
  consumed: number;
  refunded: number;
  purchased: number;
  adjusted: number;
  expired: number;
  balance: number;
}

export interface CreditTransaction {
  id: string;
  transaction_type: 'PURCHASE' | 'ADJUSTMENT' | 'RESERVED' | 'CONSUMED' | 'REFUNDED' | 'EXPIRY';
  amount: number;
  reference: string;
  reason: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface SmsPayment {
  id: string;
  package_name: string | null;
  amount_kes: number;
  credits_requested: number;
  masked_mpesa_ref: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'CANCELLED';
  rejection_reason: string | null;
  submitted_at: string | null;
  verified_at: string | null;
}

export interface CreditCenter {
  balances: CreditBalances;
  transactions: Paged<CreditTransaction>;
  packages: { id: string; name: string; credits_amount: number; price_kes: number }[];
  payments: SmsPayment[];
  health: { days: number; sent: number; failed: number; waiting: number; pending_provider: number; skipped: number; success_rate: number | null };
  settings: { receipt_sms_enabled: boolean; alert_sms_enabled: boolean };
  can_purchase: boolean;
  payment_instructions: string;
}

export const getCreditCenter = (params: Record<string, string | number> = {}) => coop<CreditCenter>(`/sms-credits/center${toQuery(params)}`);
export const buyCredits = (body: { package_id?: string; credits?: number; amount_kes?: number; mpesa_reference: string }) =>
  coop<SmsPayment>('/sms-credits/payments', send('POST', body));
export const cancelCreditPayment = (id: string, reason: string) => coop<SmsPayment>(`/sms-credits/payments/${id}/cancel`, send('POST', { reason }));
export const updateSmsSettings = (body: { receipt_sms_enabled?: boolean; alert_sms_enabled?: boolean }) =>
  coop<{ receipt_sms_enabled: boolean; alert_sms_enabled: boolean }>('/sms-settings', send('PATCH', body));

export interface SmsMessage {
  id: string;
  type: string;
  recipient_phone: string;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}
export const listSmsMessages = (params: Record<string, string | number>) => coop<Paged<SmsMessage>>(`/sms-messages${toQuery(params)}`);
export const retrySms = (id: string) => coop<SmsMessage>(`/notifications/${id}/retry`, send('POST'));

// ---------------- pricing ----------------

export interface MilkPrice {
  id: string;
  effective_from: string;
  effective_to: string | null;
  price_per_kg: number;
  currency: string;
  status: 'ACTIVE' | 'CANCELLED';
  notes: string | null;
  created_at: string | null;
  cancel_reason: string | null;
  used_by_payments: boolean;
}

export const listPrices = () => coop<{ items: MilkPrice[]; current: MilkPrice | null; can_manage: boolean }>('/prices');
export const createPrice = (body: { effective_from: string; effective_to?: string | null; price_per_kg: number; notes?: string | null }) =>
  coop<MilkPrice>('/prices', send('POST', body));
export const cancelPrice = (id: string, reason: string) => coop<MilkPrice>(`/prices/${id}/cancel`, send('POST', { reason }));

// ---------------- farmer payments ----------------

export type FarmerPaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface FarmerPayment {
  id: string;
  reference: string;
  farmer_id: string;
  farmer_name: string | null;
  farmer_number: string | null;
  period_start: string;
  period_end: string;
  total_kg: number;
  average_price_per_kg: number | null;
  gross_amount: number;
  adjustments_amount: number;
  net_amount: number;
  currency: string;
  status: FarmerPaymentStatus;
  payment_method: string | null;
  payment_account: string | null;
  payment_reference: string | null;
  failure_reason: string | null;
  paid_at: string | null;
}

export interface FarmerPaymentDetail extends FarmerPayment {
  lines: { collection_id: string; collection_reference: string; collection_date: string; quantity_kg: number; price_per_kg: number; amount: number; is_active: boolean }[];
  adjustments: { id: string; amount: number; reason: string; source_type: string; status: string; created_at: string }[];
}

export type FarmerPaymentPage = Paged<FarmerPayment> & {
  summary: Record<string, { count: number; amount: number }>;
  pending_adjustments: number;
  can_manage: boolean;
  payout_provider: string | null;
};

export interface PaymentPreview {
  period_start: string;
  period_end: string;
  farmers: number;
  lines: number;
  carried_forward_lines: number;
  total_kg: number;
  gross_amount: number;
  adjustments_amount: number;
  net_amount: number;
  missing_price_dates: string[];
}

export const listFarmerPayments = (params: Record<string, string | number>) => coop<FarmerPaymentPage>(`/farmer-payments${toQuery(params)}`);
export const getFarmerPayment = (id: string) => coop<FarmerPaymentDetail>(`/farmer-payments/${id}`);
export const previewPayments = (period_start: string, period_end: string) =>
  coop<PaymentPreview>('/farmer-payments/preview', send('POST', { period_start, period_end }));
export const generatePayments = (period_start: string, period_end: string) =>
  coop<{ created: FarmerPayment[]; skipped: { farmer_number: string; reason: string }[] }>('/farmer-payments/generate', send('POST', { period_start, period_end }));
export const setPaymentStatus = (id: string, body: { status: FarmerPaymentStatus; payment_reference?: string; reason?: string }) =>
  coop<FarmerPaymentDetail>(`/farmer-payments/${id}/status`, send('POST', body));

// ---------------- notification center ----------------

export interface InboxItem {
  id: string;
  category: 'COOLER' | 'SMS' | 'COLLECTION' | 'PAYMENT' | 'SYNC' | 'SYSTEM';
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export const listInbox = (params: Record<string, string | number | boolean>) => inboxApi<Paged<InboxItem> & { unread: number }>(toQuery(params));
export const inboxCount = () => inboxApi<{ unread: number }>('/count');
export const markInboxRead = (ids?: string[]) => inboxApi<{ marked: number }>('/read', send('POST', ids ? { ids } : {}));

// ---------------- reports ----------------

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportResult {
  kind: string;
  title: string;
  range: { from: string; to: string };
  columns: ReportColumn[];
  rows: Record<string, string | number | boolean | null>[];
  summary: Record<string, number | string | null>;
  truncated: boolean;
  row_count: number;
}

export const reportCatalogue = () => reportsApi<{ kind: string; title: string; available: boolean }[]>('');
export const runReport = (kind: string, params: Record<string, string | number | boolean>) => reportsApi<ReportResult>(`/${kind}${toQuery(params)}`);
/** Same-origin download URL (the session cookie authorises it). */
export const reportDownloadUrl = (kind: string, params: Record<string, string | number | boolean>, format: 'csv' | 'xlsx') =>
  `/api/v1/reports/${kind}${toQuery({ ...params, format })}`;

// ---------------- search ----------------

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  context: string | null;
  batch_id?: string;
}

export const workspaceSearch = (q: string) => searchApi<{ query: string; results: SearchResult[] }>(toQuery({ q }));
