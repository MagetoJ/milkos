// The device's local databases (IndexedDB through Dexie).
//
//   milkos-meta          device identity and offline sessions; shared by everyone using this browser
//   milkos-u-<userId>    one database per signed-in user: that user's cooperative data and change queue.
//                        Another user on the same device can never read it through the app, and signing
//                        out deletes it (unless changes are still waiting to sync).
//
// Operational records never go to localStorage; it keeps only the access token (as before).
import Dexie, { type Table } from 'dexie';
import type { Local, OfflineSessionRecord, QueueItem } from './types';

type Row = Local<Record<string, unknown>> & { id: string };

export interface MetaKV {
  key: string;
  value: unknown;
}

export class MetaDB extends Dexie {
  kv!: Table<MetaKV, string>;
  sessions!: Table<OfflineSessionRecord, string>;

  constructor() {
    super('milkos-meta');
    this.version(1).stores({ kv: 'key', sessions: 'userId' });
  }
}

export class UserDB extends Dexie {
  cooperative!: Table<Row, string>;
  farmers!: Table<Row, string>;
  centres!: Table<Row, string>;
  coolers!: Table<Row, string>;
  collectors!: Table<Row, string>;
  team!: Table<Row, string>;
  collections!: Table<Row, string>;
  /** Collection batches (one weighing allocated to farmers); their lines arrive as `collections`. */
  batches!: Table<Row, string>;
  readings!: Table<Row, string>;
  sensors!: Table<Row, string>;
  notifications!: Table<Row, string>;
  queue!: Table<QueueItem, number>;
  meta!: Table<MetaKV, string>;

  constructor(public readonly userId: string) {
    super(userDbName(userId));
    this.version(1).stores({
      cooperative: 'id',
      farmers: 'id, last_name, status, centre_id, farmer_number, _status',
      centres: 'id, name, status',
      coolers: 'id, code, status, centre_id',
      collectors: 'id, user_id, status',
      team: 'id, role',
      collections: 'id, collection_date, farmer_id, collector_id, cooler_id, _status',
      readings: 'id, cooler_id, measured_at, [cooler_id+measured_at], _status',
      sensors: 'id, cooler_id',
      notifications: 'id, cooler_id, created_at, status',
      queue: '++seq, &mutation_id, status, local_id, entity_type',
      meta: 'key',
    });
    // v2: collection batches. Adding a table keeps every existing row and the queue untouched.
    this.version(2).stores({
      batches: 'id, collection_date, collector_id, cooler_id, status, _status',
    });
  }
}

export const userDbName = (userId: string) => `milkos-u-${userId}`;

let meta: MetaDB | null = null;
let current: UserDB | null = null;

export function metaDb(): MetaDB {
  meta ??= new MetaDB();
  return meta;
}

/** Open (or switch to) the database of `userId`. */
export function openUserDb(userId: string): UserDB {
  if (current?.userId === userId) return current;
  current?.close();
  current = new UserDB(userId);
  return current;
}

/** The open user database. Throws if no offline-capable session has been started. */
export function userDb(): UserDB {
  if (!current) throw new Error('The local database is not open (no offline session).');
  return current;
}

export function hasUserDb(): boolean {
  return current !== null;
}

export async function closeUserDb(): Promise<void> {
  current?.close();
  current = null;
}

/** Delete one user's local data. Callers must check for unsynced changes first (see session.ts). */
export async function deleteUserDb(userId: string): Promise<void> {
  if (current?.userId === userId) await closeUserDb();
  await Dexie.delete(userDbName(userId));
}

export async function getMeta<T>(db: UserDB | MetaDB, key: string): Promise<T | undefined> {
  const row = await (db instanceof UserDB ? db.meta : db.kv).get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: UserDB | MetaDB, key: string, value: unknown): Promise<void> {
  await (db instanceof UserDB ? db.meta : db.kv).put({ key, value });
}

/** Tests only: close and forget the open databases so the next call opens fresh ones. */
export async function resetDatabasesForTests(): Promise<void> {
  current?.close();
  meta?.close();
  current = null;
  meta = null;
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
}
