import Dexie, { type EntityTable } from 'dexie';

export interface LocalFarmer {
  id: string;
  member_number: string;
  full_name: string;
  phone: string;
  route_id: string;
  cooperative_id: string;
  updated_at: string;
}

export interface LocalCollection {
  client_tx_id: string;
  server_id?: string;
  farmer_id: string;
  farmer_name: string;
  member_number: string;
  weight_kg: number;
  grade: 'A' | 'B' | 'C';
  shift: 'MORNING' | 'EVENING';
  collected_at: string;
  sync_status: 'pending' | 'synced' | 'failed';
  receipt_printed: boolean;
  updated_at: string;
}

export interface SyncQueueItem {
  id?: number;
  client_tx_id: string;
  action: 'CREATE_COLLECTION' | 'UPDATE_COLLECTION';
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'failed';
  retry_count: number;
  last_error?: string;
  created_at: string;
}

export interface SyncMeta {
  key: string;
  value: string;
}

class MilkOSDatabase extends Dexie {
  farmers!: EntityTable<LocalFarmer, 'id'>;
  collections!: EntityTable<LocalCollection, 'client_tx_id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'key'>;

  constructor() {
    super('MilkOSOfflineDB');
    this.version(1).stores({
      farmers: 'id, member_number, full_name, route_id, cooperative_id',
      collections: 'client_tx_id, farmer_id, collected_at, sync_status',
      syncQueue: '++id, client_tx_id, status, created_at',
      syncMeta: 'key',
    });
  }
}

export const db = new MilkOSDatabase();
