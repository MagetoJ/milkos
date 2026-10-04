import { ApiError, createApi, send, toQuery } from '@/lib/api-client';
import { hasUserDb, userDb } from '@/lib/offline/db';
import { nowIso, uuid } from '@/lib/offline/ids';
import { saveChange } from '@/lib/offline/mutations';
import { farmerMatches, getRawRow, initialSyncDone, listCollections as listLocalCollections } from '@/lib/offline/repositories';
import { getActiveSession, hasPermission } from '@/lib/offline/session';
import { validateCollection } from '@/lib/offline/validation';
import { pendingMutationIdsFor } from '@/lib/sync/queue';
import type { Collection, CollectionSummary, Page } from '@/app/superadmin/_types/platform-types';

// Same-origin through the Next.js rewrite, with the session cookie. What comes back is decided by the
// server from the signed-in account: staff see their cooperative, collectors their own records,
// farmers their own deliveries.
//
// Offline-first: once this device holds an offline session and has downloaded its data, lists and the
// recording form read the local database, and new collections go through the sync queue (instant
// locally, sent at once when online, kept as "pending sync" when not). Collections are append-only.
const request = createApi('/api/v1/collections');

export type CollectionPage = Page<Collection> & { summary: CollectionSummary; role: string; can_record: boolean; offline?: boolean };

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

async function localReady() {
  return hasUserDb() && (await initialSyncDone());
}

type Row = Record<string, unknown>;

export async function listCollections(params: Record<string, string | number>): Promise<CollectionPage> {
  if (!(await localReady())) return request<CollectionPage>(toQuery(params));
  const session = await getActiveSession();
  const page = await listLocalCollections<Collection>({
    search: String(params.search ?? ''),
    quality_status: String(params.quality_status ?? ''),
    date_from: String(params.date_from ?? ''),
    date_to: String(params.date_to ?? ''),
    sort: params.sort ? String(params.sort) : undefined,
    page: Number(params.page ?? 1),
    page_size: Number(params.page_size ?? 25),
  });
  return {
    ...page,
    role: session?.user.role ?? '',
    can_record: hasPermission(session, 'collection.create'),
    offline: true,
  };
}

export async function recordingOptions(search = ''): Promise<RecordingOptions> {
  if (!(await localReady())) return request<RecordingOptions>(`/options${toQuery({ search })}`);
  const db = userDb();
  const session = await getActiveSession();
  const farmers = ((await db.farmers.where('status').equals('ACTIVE').toArray()) as Row[])
    .filter((f) => farmerMatches(f, search))
    .sort((a, b) => String(a.last_name).localeCompare(String(b.last_name)) || String(a.first_name).localeCompare(String(b.first_name)))
    .slice(0, 25);
  const coolers = ((await db.coolers.where('status').equals('ACTIVE').toArray()) as Row[]).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const collectors = ((await db.collectors.where('status').equals('ACTIVE').toArray()) as Row[]).sort((a, b) =>
    String(a.full_name).localeCompare(String(b.full_name)),
  );
  const isCollector = session?.user.role === 'COLLECTOR';
  const mine = isCollector ? collectors.find((c) => c.user_id === session?.userId) : undefined;
  return {
    farmers: farmers.map((f) => ({ id: String(f.id), label: `${f.full_name} (${f.farmer_number})` })),
    coolers: coolers.map((c) => ({ id: String(c.id), label: `${c.name} (${c.code})`, is_operational: !!c.is_operational })),
    collectors: isCollector ? [] : collectors.map((c) => ({ id: String(c.id), label: `${c.full_name} (${c.collector_number})` })),
    ...(isCollector ? { default_cooler_id: (mine?.cooler_id as string | null) ?? null } : {}),
  };
}

export async function recordCollection(data: CollectionInput): Promise<Collection> {
  if (!hasUserDb()) return request<Collection>('', send('POST', data));
  validateCollection(data);
  const db = userDb();
  const session = await getActiveSession();
  const farmer = await getRawRow('farmers', data.farmer_id);
  if (!farmer) throw new ApiError(422, 'Choose a farmer from this cooperative.', { farmer_id: 'Choose a farmer from this cooperative.' });
  const collectors = (await db.collectors.toArray()) as Row[];
  const collector =
    session?.user.role === 'COLLECTOR'
      ? collectors.find((c) => c.user_id === session.userId)
      : data.collector_id
        ? collectors.find((c) => c.id === data.collector_id)
        : undefined;
  const coolerId = data.cooler_id || (collector?.cooler_id as string | undefined) || null;
  const cooler = coolerId ? await getRawRow('coolers', coolerId) : undefined;
  const coop = (await db.cooperative.toCollection().first()) as Row | undefined;

  const now = new Date();
  const id = uuid();
  const day = data.collection_date ?? now.toISOString().slice(0, 10);
  // The server stores the time in UTC (as when it fills it in itself).
  const time = now.toISOString().slice(11, 19);
  const quality = data.quality_status ?? 'ACCEPTED';
  const { record } = await saveChange<Collection>({
    mutation: {
      entity_type: 'collection', operation: 'create', local_id: id, table: 'collections',
      payload: { ...data, collection_date: day, collection_time: time } as Record<string, unknown>,
      // An offline-created farmer must reach the server before its collection.
      depends_on: await pendingMutationIdsFor(db, [data.farmer_id]),
    },
    table: 'collections',
    entity: 'collection',
    interactive: true,
    optimistic: {
      id,
      reference: 'Pending sync',
      cooperative_id: String(coop?.id ?? session?.user.cooperative_id ?? ''),
      cooperative_name: String(coop?.name ?? session?.user.cooperative_name ?? ''),
      cooperative_code: String(coop?.code ?? session?.user.cooperative_code ?? ''),
      farmer_id: data.farmer_id,
      farmer_name: String(farmer.full_name),
      farmer_number: String(farmer.farmer_number),
      collector_id: (collector?.id as string | undefined) ?? null,
      collector_name: (collector?.full_name as string | undefined) ?? null,
      collector_number: (collector?.collector_number as string | undefined) ?? null,
      cooler_id: coolerId,
      cooler_name: (cooler?.name as string | undefined) ?? null,
      cooler_code: (cooler?.code as string | undefined) ?? null,
      collection_date: day,
      collection_time: time.slice(0, 5),
      quantity_litres: data.quantity_litres,
      fat_percentage: data.fat_percentage ?? null,
      snf_percentage: data.snf_percentage ?? null,
      temperature_c: data.temperature_c ?? null,
      // "Automatic" quality is decided by the server's limits when the record syncs.
      quality_status: quality,
      rejection_reason: quality === 'REJECTED' ? (data.rejection_reason ?? null) : null,
      notes: data.notes ?? null,
      recorded_by: session?.userId ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  });
  return record;
}
