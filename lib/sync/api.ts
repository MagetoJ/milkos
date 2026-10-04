// HTTP calls of the sync protocol (backend/routers/sync.py). Every call carries the access token and
// this device's id; the server derives the cooperative from the account, never from what we send.
import { getSession } from '@/lib/auth';
import { reportRequest } from '@/lib/offline/connectivity';
import { getDeviceId } from '@/lib/offline/device';
import type { MutationError, PulledEntity, QueueItem } from '@/lib/offline/types';
import type { Change } from './apply';

export type FailureKind = 'network' | 'auth' | 'forbidden' | 'server' | 'client';

export class SyncHttpError extends Error {
  constructor(public kind: FailureKind, message: string, public status = 0) {
    super(message);
  }
}

export interface MutationResult {
  mutation_id: string;
  entity_type: string;
  local_id: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'error';
  server_id: string | null;
  server_version: number | null;
  entity: Record<string, unknown> | null;
  error: MutationError | null;
}

export interface PullPage {
  changes: Change[];
  cursor: number;
  has_more: boolean;
  server_time: string;
  window: { collection_days: number; reading_days: number; notification_days: number };
}

export interface SyncStatusResponse {
  status: string;
  server_time: string;
  cursor: number;
  offline_session_expires_at: string;
  open_conflicts: number;
  last_24h: { applied: number; rejected: number; conflicts: number };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSession()?.token;
  let res: Response;
  try {
    res = await fetch(`/api/v1/sync${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': await getDeviceId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    reportRequest(false);
    throw new SyncHttpError('network', "Can't reach the MilkOS server.");
  }
  // A gateway error means the proxy is up but the API isn't: the server is unreachable.
  reportRequest(![502, 503, 504].includes(res.status));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  const detail = (body as { detail?: unknown } | null)?.detail;
  const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
  if (res.status === 401) throw new SyncHttpError('auth', message, 401);
  if (res.status === 403) throw new SyncHttpError('forbidden', message, 403);
  if (res.status >= 500) throw new SyncHttpError('server', message, res.status);
  if (!res.ok) throw new SyncHttpError('client', message, res.status);
  return body as T;
}

export function toWire(item: QueueItem) {
  return {
    mutation_id: item.mutation_id,
    entity_type: item.entity_type,
    operation: item.operation,
    local_id: item.local_id,
    base_version: item.base_version,
    base: item.base,
    client_timestamp: item.client_timestamp,
    payload: item.payload,
  };
}

export const pushMutations = (items: QueueItem[]) =>
  call<{ results: MutationResult[]; cursor: number; server_time: string }>('/push', {
    method: 'POST',
    body: JSON.stringify({ mutations: items.map(toWire) }),
  });

export const pullChanges = (cursor: number, limit = 500) => call<PullPage>(`/pull?cursor=${cursor}&limit=${limit}`);

export const syncStatus = () => call<SyncStatusResponse>('/status');

export const resolveConflict = (mutationId: string, resolution: 'discarded' | 'retried' | 'edited') =>
  call<{ resolved: boolean }>('/conflicts/resolve', {
    method: 'POST',
    body: JSON.stringify({ mutation_id: mutationId, resolution }),
  });

export type { PulledEntity };
