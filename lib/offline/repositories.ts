// Reading the local database the way the server's list endpoints answer, so screens render either
// source unchanged. Lists are filtered with IndexedDB cursors and paged; whole tables are never handed
// to React.
import { userDb, getMeta } from './db';
import type { LocalMeta } from './types';

type Row = Record<string, unknown> & LocalMeta & { id: string };

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const lower = (v: unknown) => str(v).toLowerCase();

/** Expose the sync state as `sync_status` (what the UI reads), without the other internal fields. */
export function publicRow<T>(row: Row): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) out[k] = v;
  out.sync_status = row._status;
  out.sync_error = row._error ?? null;
  return out as T;
}

/** The national part of a phone number typed as 07.., 2547.., +2547.. (mirrors backend core.utils.phone_digits). */
export function phoneDigits(term: string): string | null {
  if (!/^\+?\d+$/.test(term)) return null;
  let digits = term.replace(/^\+/, '');
  digits = digits.startsWith('0') ? digits.slice(1) : digits.startsWith('254') ? digits.slice(3) : digits;
  return digits.length >= 3 ? digits : null;
}

/**
 * Whether typed phone digits fit a masked number (0712••••78) using only the digits a collector's device holds:
 * a short entry must match the start, a full number must match both the visible start and end. It narrows the
 * list; an exact phone lookup happens on the server when online.
 */
export function maskedPhoneMatches(masked: string, digits: string): boolean {
  const m = /^0?(\d+)•+(\d+)$/.exec(masked);
  if (!m) return false;
  const [, start, end] = m;
  if (digits.length <= start.length) return start.startsWith(digits);
  return digits.startsWith(start) && digits.endsWith(end);
}

/** Every word must match one of the farmer's fields (mirrors backend services.farmers.search_filter). */
export function farmerMatches(row: Record<string, unknown>, search: string | undefined): boolean {
  for (const term of (search ?? '').trim().split(/\s+/).filter(Boolean)) {
    const t = term.toLowerCase();
    const fields = [row.first_name, row.last_name, row.farmer_number, row.national_id, row.village];
    let hit = fields.some((f) => lower(f).includes(t));
    const digits = phoneDigits(term);
    if (!hit && digits) hit = row.phone ? str(row.phone).includes(digits) : maskedPhoneMatches(str(row.phone_masked), digits);
    if (!hit) return false;
  }
  return true;
}

const byName = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  lower(a.last_name).localeCompare(lower(b.last_name)) ||
  lower(a.first_name).localeCompare(lower(b.first_name)) ||
  str(a.farmer_number).localeCompare(str(b.farmer_number));

export interface FarmerFilter {
  search?: string;
  centre?: string; // centre id, 'none', or ''
  status?: string;
  page: number;
  pageSize: number;
}

export async function listFarmers<T>(q: FarmerFilter): Promise<{ items: T[]; total: number; page: number; page_size: number }> {
  const db = userDb();
  const matches = (row: Row) =>
    (!q.status || row.status === q.status) &&
    (!q.centre || (q.centre === 'none' ? !row.centre_id : row.centre_id === q.centre)) &&
    farmerMatches(row, q.search);
  // The cursor walks the last_name index and keeps only matches; the matches are then put in the
  // server's full order (last name, first name, number) and only one page leaves this function.
  const all = (await db.farmers.orderBy('last_name').filter((r) => matches(r as Row)).toArray()) as Row[];
  all.sort(byName);
  const start = (q.page - 1) * q.pageSize;
  return {
    items: all.slice(start, start + q.pageSize).map((r) => publicRow<T>(r)),
    total: all.length,
    page: q.page,
    page_size: q.pageSize,
  };
}

export async function listAll<T>(table: 'cooperative' | 'centres' | 'coolers' | 'collectors' | 'team' | 'sensors', sort?: (a: Row, b: Row) => number): Promise<T[]> {
  const rows = (await userDb().table(table).toArray()) as Row[];
  if (sort) rows.sort(sort);
  return rows.map((r) => publicRow<T>(r));
}

export async function getRow<T>(table: string, id: string): Promise<T | null> {
  const row = (await userDb().table(table).get(id)) as Row | undefined;
  return row ? publicRow<T>(row) : null;
}

export async function getRawRow(table: string, id: string): Promise<Row | undefined> {
  return (await userDb().table(table).get(id)) as Row | undefined;
}

export async function cooperativeRow<T>(): Promise<T | null> {
  const row = (await userDb().cooperative.toCollection().first()) as Row | undefined;
  return row ? publicRow<T>(row) : null;
}

export async function initialSyncDone(): Promise<boolean> {
  try {
    return !!(await getMeta<boolean>(userDb(), 'initial_sync_done'));
  } catch {
    return false;
  }
}

// ---------------- milk collections ----------------

export interface CollectionFilter {
  search?: string;
  quality_status?: string;
  date_from?: string;
  date_to?: string;
  farmer_id?: string;
  collector_id?: string;
  cooler_id?: string;
  sort?: string;
  /** Also list superseded (corrected) and reversed lines; they never count in the summary. */
  include_history?: boolean;
  page: number;
  page_size: number;
}

export async function listCollections<T>(q: CollectionFilter) {
  const db = userDb();
  const terms = (q.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (await db.collections
    .filter((r) => {
      const row = r as Row;
      if (q.quality_status && row.quality_status !== q.quality_status) return false;
      if (q.date_from && str(row.collection_date) < q.date_from) return false;
      if (q.date_to && str(row.collection_date) > q.date_to) return false;
      if (q.farmer_id && row.farmer_id !== q.farmer_id) return false;
      if (q.collector_id && row.collector_id !== q.collector_id) return false;
      if (q.cooler_id && row.cooler_id !== q.cooler_id) return false;
      if (!q.include_history && row.record_status && row.record_status !== 'ACTIVE') return false;
      return terms.every((t) => [row.reference, row.farmer_name, row.farmer_number].some((f) => lower(f).includes(t)));
    })
    .toArray()) as Row[];

  const sortKey = (q.sort ?? '').replace(/^-/, '');
  const desc = !q.sort || q.sort.startsWith('-');
  rows.sort((a, b) => {
    if (sortKey === 'quantity_litres') return (Number(a.quantity_litres) - Number(b.quantity_litres)) * (desc ? -1 : 1);
    const ka = `${str(a.collection_date)} ${str(a.collection_time)}`;
    const kb = `${str(b.collection_date)} ${str(b.collection_time)}`;
    return ka.localeCompare(kb) * (desc ? -1 : 1);
  });

  const effective = rows.filter((r) => !r.record_status || r.record_status === 'ACTIVE');
  const accepted = effective.filter((r) => r.quality_status === 'ACCEPTED');
  const rejected = effective.filter((r) => r.quality_status === 'REJECTED');
  const fats = accepted.map((r) => r.fat_percentage).filter((v): v is number => typeof v === 'number');
  const sum = (list: Row[]) => list.reduce((s, r) => s + Number(r.quantity_litres || 0), 0);
  const start = (q.page - 1) * q.page_size;
  return {
    items: rows.slice(start, start + q.page_size).map((r) => publicRow<T>(r)),
    total: rows.length,
    page: q.page,
    page_size: q.page_size,
    pages: Math.max(1, Math.ceil(rows.length / q.page_size)),
    summary: {
      collections: effective.length,
      accepted_litres: Math.round(sum(accepted) * 100) / 100,
      accepted_kg: Math.round(accepted.reduce((s, r) => s + Number(r.quantity_kg || 0), 0) * 100) / 100,
      rejected_collections: rejected.length,
      rejected_litres: Math.round(sum(rejected) * 100) / 100,
      average_fat_percentage: fats.length ? Math.round((fats.reduce((s, v) => s + v, 0) / fats.length) * 100) / 100 : null,
    },
  };
}

// ---------------- cooler readings ----------------

export async function readingsFor<T>(coolerId: string, limit = 50): Promise<T[]> {
  const rows = (await userDb()
    .readings.where('[cooler_id+measured_at]')
    .between([coolerId, ''], [coolerId, '￿'])
    .reverse()
    .limit(limit)
    .toArray()) as Row[];
  return rows.map((r) => publicRow<T>(r));
}

export async function latestReadings<T>(limit = 10): Promise<T[]> {
  const rows = (await userDb().readings.orderBy('measured_at').reverse().limit(limit).toArray()) as Row[];
  return rows.map((r) => publicRow<T>(r));
}

export async function latestReadingFor<T>(coolerId: string): Promise<T | null> {
  const [row] = await readingsFor<T>(coolerId, 1);
  return row ?? null;
}

export async function recentNotifications<T>(limit = 10): Promise<T[]> {
  const rows = (await userDb().notifications.orderBy('created_at').reverse().limit(limit).toArray()) as Row[];
  return rows.map((r) => publicRow<T>(r));
}

export async function recentCollections<T>(limit = 5): Promise<T[]> {
  const rows = (await userDb().collections.orderBy('collection_date').reverse().limit(limit * 4).toArray()) as Row[];
  rows.sort((a, b) => `${str(b.collection_date)} ${str(b.collection_time)}`.localeCompare(`${str(a.collection_date)} ${str(a.collection_time)}`));
  return rows.slice(0, limit).map((r) => publicRow<T>(r));
}
