import { createApi, send, toQuery } from '@/lib/api-client';
import type { Collection, CollectionSummary, Page } from '@/app/superadmin/_types/platform-types';

// Same-origin through the Next.js rewrite, with the session cookie. What comes back is decided by the
// server from the signed-in account: staff see their cooperative, collectors their own records,
// farmers their own deliveries.
const request = createApi('/api/v1/collections');

export type CollectionPage = Page<Collection> & { summary: CollectionSummary; role: string; can_record: boolean };

export interface RecordingOptions {
  farmers: { id: string; label: string }[];
  coolers: { id: string; label: string; is_operational: boolean }[];
  collectors: { id: string; label: string }[];
  default_cooler_id?: string | null;
}

export interface CollectionInput {
  farmer_id: string;
  collector_id?: string | null;
  cooler_id?: string | null;
  collection_date?: string;
  quantity_litres: number;
  fat_percentage?: number | null;
  snf_percentage?: number | null;
  temperature_c?: number | null;
  quality_status?: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  rejection_reason?: string | null;
  notes?: string | null;
}

export const listCollections = (params: Record<string, string | number>) => request<CollectionPage>(toQuery(params));
export const recordingOptions = (search = '') => request<RecordingOptions>(`/options${toQuery({ search })}`);
export const recordCollection = (data: CollectionInput) => request<Collection>('', send('POST', data));
