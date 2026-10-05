// Shared types of the offline platform (local database, sync queue, offline session).

/** Sync state of one local record. */
export type RecordSyncStatus = 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';

/** Entities the server accepts from devices (see backend/schemas/sync.py). */
export type MutationEntity = 'farmer' | 'centre' | 'collection' | 'collection_batch' | 'cooler_reading' | 'sensor_event';
export type MutationOperation = 'create' | 'update';

/** Entities the server sends to devices. */
export type PulledEntity =
  | 'cooperative'
  | 'farmer'
  | 'centre'
  | 'cooler'
  | 'collector'
  | 'team_member'
  | 'collection'
  | 'collection_batch'
  | 'cooler_reading'
  | 'sensor'
  | 'notification';

/**
 * Metadata kept on every locally stored record. The record's own `id` is the client-generated id while
 * it is pending, and the server id once synced (they are equal unless the server had to allocate a new one).
 */
export interface LocalMeta {
  _status: RecordSyncStatus;
  _entity: PulledEntity;
  _local_id: string;
  _server_id: string | null;
  _device_id: string | null;
  _local_created_at: string;
  _local_updated_at: string;
  _last_synced_at: string | null;
  _error?: string | null;
}

export type Local<T> = T & LocalMeta;

export type QueueStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export interface MutationError {
  code: string; // validation | conflict | forbidden | not_found | server_error | network
  message: string;
  fields: Record<string, string>;
}

/** One outbound change, persisted until the server has it. Synced items are removed. */
export interface QueueItem {
  seq?: number;
  mutation_id: string;
  entity_type: MutationEntity;
  operation: MutationOperation;
  local_id: string;
  /** Local table the optimistic record lives in, and its id there. */
  table: LocalTable | null;
  base_version: number | null;
  base: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  client_timestamp: string;
  /** Mutations that must reach the server first (e.g. the offline farmer a collection belongs to). */
  depends_on: string[];
  status: QueueStatus;
  attempts: number;
  next_attempt_at: number;
  last_error: MutationError | null;
  /** The record as it was before an optimistic update, to restore it if the change is discarded. */
  previous: Record<string, unknown> | null;
  /** Server copy returned with a conflict. */
  server_entity: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type LocalTable =
  | 'cooperative'
  | 'farmers'
  | 'centres'
  | 'coolers'
  | 'collectors'
  | 'team'
  | 'collections'
  | 'batches'
  | 'readings'
  | 'sensors'
  | 'notifications';

/** The offline session issued by POST /api/v1/devices/register (only for a user who signed in online). */
export interface OfflineUser {
  id: string;
  email: string;
  full_name: string;
  role: 'SUPER_ADMIN' | 'COOP_ADMIN' | 'MANAGER' | 'COLLECTOR' | 'FARMER';
  cooperative_id: string | null;
  cooperative_name: string | null;
  cooperative_code: string | null;
}

export interface OfflineSessionRecord {
  userId: string;
  user: OfflineUser;
  permissions: string[];
  /** Device session secret (exchanged for an access token when back online). Never a password. */
  token: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  lastOnlineAt: string;
  /** Highest device clock seen, to notice a clock turned back to stretch the offline window. */
  clockHighWater: number;
}
