// The sync engine: pushes the queue, pulls server changes, and keeps everything else informed.
//
// It runs when the workspace starts, when the server becomes reachable again, shortly after a local
// change, every minute while the app is visible, and when someone presses "Sync now". Failures are
// classified (network, expired session, forbidden device, server error, validation, conflict) and handled
// differently; nothing is retried aggressively: repeated failures back off up to 30 minutes.
import { getConnectivity, isServerReachable, probe, subscribeConnectivity } from '@/lib/offline/connectivity';
import { refreshWithDeviceSession } from '@/lib/offline/auth';
import { getMeta, openUserDb, setMeta, type UserDB } from '@/lib/offline/db';
import { emitLocalChange, onLocalChange } from '@/lib/offline/events';
import { nowIso } from '@/lib/offline/ids';
import { extendOfflineSession } from '@/lib/offline/session';
import type { QueueStatus } from '@/lib/offline/types';
import { pullChanges, pushMutations, syncStatus, SyncHttpError, type MutationResult } from './api';
import { applyPulled, applyServerEntity, markRecord, PULLED_OF_MUTATION, pruneHistory } from './apply';
import { backoffMs, deferItems, dueBatch, queueCounts, removeItem, setStatus, settleItem } from './queue';
import type { QueueItem } from '@/lib/offline/types';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'auth-required' | 'blocked' | 'error';

export interface SyncState {
  userId: string | null;
  phase: SyncPhase;
  counts: Record<QueueStatus, number>;
  lastSyncAt: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  initialSyncDone: boolean;
  /** Records synchronised by the last cycle (pushed + pulled). */
  lastCycle: { pushed: number; pulled: number } | null;
  offlineSessionExpiresAt: string | null;
}

type Listener = (state: SyncState) => void;

const INTERVAL_VISIBLE_MS = 60_000;
const INTERVAL_HIDDEN_MS = 5 * 60_000;
const STATUS_EVERY_MS = 5 * 60_000;
const MAX_PULL_PAGES = 50;

const EMPTY_COUNTS: Record<QueueStatus, number> = { pending: 0, syncing: 0, failed: 0, conflict: 0 };

class SyncEngine {
  private state: SyncState = {
    userId: null,
    phase: 'idle',
    counts: { ...EMPTY_COUNTS },
    lastSyncAt: null,
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    initialSyncDone: false,
    lastCycle: null,
    offlineSessionExpiresAt: null,
  };
  private listeners = new Set<Listener>();
  private db: UserDB | null = null;
  private running: Promise<void> | null = null;
  /** One follow-up run, shared by everyone who asked while a cycle was in progress. */
  private followUp: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private notBefore = 0;
  private lastStatusAt = 0;
  private unsubscribers: (() => void)[] = [];

  getState = (): SyncState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<SyncState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  get started(): boolean {
    return this.db !== null;
  }

  /** Begin syncing for `userId` (idempotent). */
  async start(userId: string): Promise<void> {
    if (this.db && this.state.userId === userId) return;
    this.stop();
    this.db = openUserDb(userId);
    const db = this.db;
    this.set({
      userId,
      phase: 'idle',
      lastSyncAt: (await getMeta<string>(db, 'last_sync_at')) ?? null,
      lastPushAt: (await getMeta<string>(db, 'last_push_at')) ?? null,
      lastPullAt: (await getMeta<string>(db, 'last_pull_at')) ?? null,
      initialSyncDone: !!(await getMeta<boolean>(db, 'initial_sync_done')),
      counts: await queueCounts(db),
      lastError: null,
    });
    this.unsubscribers.push(
      subscribeConnectivity((c) => {
        // Called on transitions only: the server just became reachable (or unreachable).
        if (c.network && c.server === 'reachable') {
          this.notBefore = 0;
          void this.syncNow();
        } else if (c.server === 'unreachable' && this.state.phase !== 'syncing') {
          this.set({ phase: 'offline' });
        }
      }),
      onLocalChange((tables) => {
        if (!tables.has('queue')) return;
        void this.refreshCounts();
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.syncNow(), 400);
      }),
    );
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void this.syncNow();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.unsubscribers.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
    this.schedule();
    void this.syncNow();
  }

  stop() {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.debounce = null;
    this.followUp = null;
    this.db = null;
    this.failures = 0;
    this.notBefore = 0;
    this.state = { ...this.state, userId: null, counts: { ...EMPTY_COUNTS }, phase: 'idle' };
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.timer = setTimeout(() => {
      void this.syncNow().finally(() => this.schedule());
    }, hidden ? INTERVAL_HIDDEN_MS : INTERVAL_VISIBLE_MS);
  }

  async refreshCounts() {
    if (!this.db) return;
    this.set({ counts: await queueCounts(this.db) });
  }

  /**
   * Run a sync cycle now (or right after the one in progress). `force` ignores the failure backoff
   * ("Sync now" / "Retry").
   */
  syncNow(options: { force?: boolean; pull?: boolean } = {}): Promise<void> {
    if (!this.db) return Promise.resolve();
    if (options.force) this.notBefore = 0;
    if (this.running) {
      // Changes made during a cycle may have missed it: run again once it ends, and let callers wait for that.
      this.followUp ??= this.running.then(() => {
        this.followUp = null;
        return this.syncNow(options);
      });
      return this.followUp;
    }
    if (Date.now() < this.notBefore) return Promise.resolve();
    this.running = this.cycle(options.pull ?? true).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Resolves when no sync cycle is running or scheduled to follow. */
  async whenIdle(): Promise<void> {
    while (this.running || this.followUp) await (this.followUp ?? this.running);
  }

  /** Wait until `mutationId` has been tried once (or `timeoutMs` passes). Used to give forms an answer. */
  async flushItem(mutationId: string, timeoutMs = 10_000): Promise<'synced' | 'failed' | 'conflict' | 'pending'> {
    const db = this.db;
    if (!db) return 'pending';
    if (!isServerReachable() && !(await probe())) return 'pending';
    const attempt = this.syncNow({ force: true, pull: false });
    await Promise.race([attempt, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    const item = await db.queue.where('mutation_id').equals(mutationId).first();
    if (!item) return 'synced';
    if (item.status === 'failed' || item.status === 'conflict') return item.status;
    return 'pending';
  }

  private async cycle(pull: boolean): Promise<void> {
    const db = this.db!;
    if (!isServerReachable()) {
      const reachable = await probe();
      if (!reachable) {
        this.set({ phase: 'offline' });
        return;
      }
    }
    this.set({ phase: 'syncing', lastError: null });
    const started = Date.now();
    try {
      const pushed = await this.pushAll(db);
      const pulled = pull ? await this.pullAll(db) : 0;
      if (Date.now() - this.lastStatusAt > STATUS_EVERY_MS) await this.checkStatus();
      const at = nowIso();
      await setMeta(db, 'last_sync_at', at);
      this.failures = 0;
      this.notBefore = 0;
      this.set({ phase: 'idle', lastSyncAt: at, lastCycle: { pushed, pulled }, counts: await queueCounts(db) });
      console.info('[milkos.sync] completed', { pushed, pulled, ms: Date.now() - started });
    } catch (error) {
      await this.handleFailure(error);
    }
  }

  private async handleFailure(error: unknown) {
    const db = this.db;
    const counts = db ? await queueCounts(db) : this.state.counts;
    if (error instanceof SyncHttpError) {
      console.warn('[milkos.sync] failed', { kind: error.kind, status: error.status });
      if (error.kind === 'network') return this.set({ phase: 'offline', counts });
      if (error.kind === 'auth') {
        return this.set({ phase: 'auth-required', counts, lastError: 'Your session has ended. Sign in again to sync.' });
      }
      if (error.kind === 'forbidden') {
        // Not retried automatically: the device or account needs attention.
        this.notBefore = Date.now() + 30 * 60_000;
        return this.set({ phase: 'blocked', counts, lastError: error.message });
      }
    } else {
      console.error('[milkos.sync] failed', error);
    }
    this.failures += 1;
    this.notBefore = Date.now() + backoffMs(this.failures);
    this.set({ phase: 'error', counts, lastError: 'The server had a problem. Sync will retry shortly.' });
  }

  /** Run `request`; on an expired access token, renew it with the device session once and retry. */
  private async withAuth<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof SyncHttpError) || error.kind !== 'auth') throw error;
      const refreshed = await refreshWithDeviceSession();
      if (refreshed === 'ok') return request();
      if (refreshed === 'unreachable') throw new SyncHttpError('network', 'Server unreachable');
      throw error;
    }
  }

  private async pushAll(db: UserDB): Promise<number> {
    let pushed = 0;
    for (let round = 0; round < 20; round++) {
      const batch = await dueBatch(db);
      if (batch.length === 0) break;
      const ids = batch.map((i) => i.mutation_id);
      await setStatus(db, ids, 'syncing');
      let results: MutationResult[];
      try {
        results = (await this.withAuth(() => pushMutations(batch))).results;
      } catch (error) {
        const kind = error instanceof SyncHttpError ? error.kind : 'server';
        // Network/auth/forbidden don't count against the items; a server error does.
        await deferItems(db, ids, { code: kind, message: kind === 'network' ? 'Waiting for connection' : 'Server error', fields: {} }, kind === 'server' || kind === 'client');
        throw error;
      }
      const byId = new Map(batch.map((i) => [i.mutation_id, i]));
      for (const result of results) {
        const item = byId.get(result.mutation_id);
        if (!item) continue;
        pushed += await this.applyResult(db, item, result);
      }
      const at = nowIso();
      await setMeta(db, 'last_push_at', at);
      this.set({ lastPushAt: at });
    }
    return pushed;
  }

  private async applyResult(db: UserDB, item: QueueItem, result: MutationResult): Promise<number> {
    switch (result.status) {
      case 'applied':
      case 'duplicate': {
        if (item.table) {
          await applyServerEntity(db, item.table, PULLED_OF_MUTATION[item.entity_type], item.local_id, result.entity, item.mutation_id);
        }
        await removeItem(db, item.mutation_id);
        console.info('[milkos.sync] mutation accepted', { entity: item.entity_type, op: item.operation, duplicate: result.status === 'duplicate' });
        return 1;
      }
      case 'conflict':
      case 'rejected': {
        const status = result.status === 'conflict' ? 'conflict' : 'failed';
        const error = result.error ?? { code: result.status, message: 'Refused by the server.', fields: {} };
        await settleItem(db, item.mutation_id, { status, error, server_entity: result.entity });
        await markRecord(db, item.table, item.local_id, status, error.message);
        console.warn('[milkos.sync] mutation', result.status, { entity: item.entity_type, op: item.operation, code: error.code });
        return 0;
      }
      default:
        await deferItems(db, [item.mutation_id], result.error ?? { code: 'server_error', message: 'Server error', fields: {} }, true);
        return 0;
    }
  }

  private async pullAll(db: UserDB): Promise<number> {
    let cursor = (await getMeta<number>(db, 'cursor')) ?? 0;
    let applied = 0;
    let window: { collection_days: number; reading_days: number; notification_days: number } | null = null;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const result = await this.withAuth(() => pullChanges(cursor));
      applied += await applyPulled(db, result.changes);
      cursor = result.cursor;
      window = result.window;
      await setMeta(db, 'cursor', cursor);
      if (!result.has_more) break;
    }
    const at = nowIso();
    await setMeta(db, 'last_pull_at', at);
    if (window) {
      await setMeta(db, 'window', window);
      await pruneHistory(db, window);
    }
    if (!this.state.initialSyncDone) {
      await setMeta(db, 'initial_sync_done', true);
      this.set({ initialSyncDone: true });
      emitLocalChange('cooperative', 'farmers', 'centres', 'coolers', 'collectors', 'team', 'collections', 'readings', 'sensors', 'notifications');
    }
    this.set({ lastPullAt: at });
    return applied;
  }

  private async checkStatus() {
    try {
      const status = await this.withAuth(() => syncStatus());
      this.lastStatusAt = Date.now();
      if (this.state.userId && status.offline_session_expires_at) {
        await extendOfflineSession(this.state.userId, status.offline_session_expires_at);
        this.set({ offlineSessionExpiresAt: status.offline_session_expires_at });
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.kind !== 'server') throw error;
    }
  }
}

export const syncEngine = new SyncEngine();
export type { SyncEngine };

/** Is the app connected to the server right now, as far as anyone knows? */
export function connectionLabel(): 'online' | 'offline' | 'checking' {
  const c = getConnectivity();
  if (!c.network || c.server === 'unreachable') return 'offline';
  return c.server === 'reachable' ? 'online' : 'checking';
}
