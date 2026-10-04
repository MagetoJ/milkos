import type { SyncStatus } from '@/app/superadmin/_types/platform-types';

export type CoopRole = 'COOP_ADMIN' | 'MANAGER';

/** Sync metadata on records read from the device's local database (absent on live server responses). */
export interface SyncFields {
  sync_status?: SyncStatus;
  sync_error?: string | null;
  sync_version?: number;
}

export interface Overview {
  role: CoopRole;
  cooperative: {
    name: string;
    code: string;
    county: string;
    location: string | null;
    status: string;
    sms_credit_balance: number;
    estimated_daily_liters: number | null;
    created_at: string | null;
  };
  farmers: { total: number; active: number; unassigned: number };
  centres: { total: number; active: number; with_cooler: number };
  coolers: { total: number; operational: number };
  team: { admins: number; managers: number; collectors: number };
  milk: { today: number; week: number; month: number; collections_today: number };
  recent_farmers: { id: string; farmer_number: string; full_name: string; phone: string; created_at: string | null }[];
  /** True when built from this device's local data because the server couldn't be reached. */
  offline?: boolean;
}

export type ActiveStatus = 'ACTIVE' | 'INACTIVE';

export interface Centre extends SyncFields {
  id: string;
  name: string;
  code: string;
  county: string;
  location_description: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  has_cooler: boolean;
  cooler_capacity_litres: number | null;
  status: ActiveStatus;
  farmer_count: number;
  created_at: string | null;
}

export interface CentreInput {
  name?: string;
  code?: string;
  county?: string;
  location_description?: string | null;
  manager_user_id?: string | null;
  has_cooler?: boolean;
  cooler_capacity_litres?: number | null;
  status?: ActiveStatus;
}

export interface Farmer extends SyncFields {
  id: string;
  farmer_number: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  national_id: string | null;
  village: string | null;
  status: ActiveStatus;
  centre_id: string | null;
  centre_name: string | null;
  created_at: string | null;
}

export interface FarmerInput {
  first_name?: string;
  last_name?: string;
  phone?: string;
  national_id?: string | null;
  village?: string | null;
  centre_id?: string | null;
  farmer_number?: string;
  status?: ActiveStatus;
}

export interface FarmerPage {
  items: Farmer[];
  total: number;
  page: number;
  page_size: number;
}

export interface FarmerQuery {
  search?: string;
  centre?: string; // a centre id, 'none', or '' for all
  status?: ActiveStatus | '';
  page: number;
  pageSize: number;
}

export type TeamRole = 'MANAGER' | 'COLLECTOR';

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  phone_number: string;
  role: 'COOP_ADMIN' | TeamRole;
  is_active: boolean;
  is_you: boolean;
  created_at: string | null;
}

export interface TeamCreateInput {
  full_name: string;
  email: string;
  phone: string;
  role: TeamRole;
  password: string;
}

export interface TeamUpdateInput {
  full_name?: string;
  phone?: string;
  role?: TeamRole;
  is_active?: boolean;
  password?: string;
}