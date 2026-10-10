// The farmer's own data (/api/v1/farmer). Read-only: collections, prices and payments are the cooperative's records.
import { createApi, toQuery } from '@/lib/api-client';

const request = createApi('/api/v1/farmer');

export type Range = 'today' | '7d' | '30d' | '3m' | 'custom';

export interface FarmerCollection {
  id: string;
  reference: string;
  date: string | null;
  time: string | null;
  quantity_kg: number | null;
  quantity_litres: number | null;
  quality_status: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  rejection_reason: string | null;
  fat_percentage: number | null;
  temperature_c: number | null;
  record_status: 'ACTIVE' | 'SUPERSEDED' | 'REVERSED';
  centre_name: string | null;
  collector_name: string | null;
  price_per_kg: number | null;
  /** True when the price is the cooperative's current price for that day (not yet paid). */
  price_is_estimate: boolean;
  amount: number | null;
  receipt_status: string | null;
  receipt_sent_at: string | null;
}

export interface FarmerCollectionDetail extends FarmerCollection {
  cooler_name: string | null;
  batch_reference: string | null;
  batch_status: string | null;
  weight_source: string | null;
  replaced_by_collection_id: string | null;
  payment: { reference: string; status: string; paid_at: string | null } | null;
}

export interface FarmerDashboard {
  farmer: { name: string; farmer_number: string; cooperative_name: string | null };
  period: { range: Range; from: string; to: string };
  today: { kg: number; deliveries: number };
  this_month: { kg: number; deliveries: number; month: string };
  totals: { kg: number; litres: number; deliveries: number; rejected: number; earnings: number; earnings_is_estimate: boolean; unpriced_deliveries: number };
  daily: { date: string; kg: number }[];
  recent: FarmerCollection[];
  last_payment: { reference: string; status: string; net_amount: number; period_start: string; period_end: string; paid_at: string | null } | null;
  unread_notifications: number;
}

export interface FarmerPaymentRow {
  id: string;
  reference: string;
  period_start: string;
  period_end: string;
  total_kg: number;
  average_price_per_kg: number | null;
  gross_amount: number;
  adjustments_amount: number;
  net_amount: number;
  currency: string;
  status: string;
  paid_at: string | null;
}

export const getDashboard = (range: Range, from?: string, to?: string) =>
  request<FarmerDashboard>(`/dashboard${toQuery({ range, date_from: from, date_to: to })}`);
export const listMyCollections = (page = 1, pageSize = 20) =>
  request<{ items: FarmerCollection[]; total: number; page: number; page_size: number }>(`/collections${toQuery({ page, page_size: pageSize })}`);
export const getMyCollection = (id: string) => request<FarmerCollectionDetail>(`/collections/${encodeURIComponent(id)}`);
export const listMyPayments = () => request<FarmerPaymentRow[]>('/payments');
export const getPriceHistory = () => request<{ price_per_kg: number; effective_from: string; effective_to: string | null }[]>('/prices');
