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
    registration_number?: string | null;
    kra_pin?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    receipt_sms_enabled?: boolean;
    alert_sms_enabled?: boolean;
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
  /** Dashboard figures (absent when built offline from local data). */
  kpis?: DashboardKpis;
  charts?: DashboardCharts;
  /** True when built from this device's local data because the server couldn't be reached. */
  offline?: boolean;
}

export interface DashboardKpis {
  milk_kg_today: number;
  milk_kg_month: number;
  milk_kg_30d: number;
  collections_today: number;
  active_farmers_30d: number;
  active_collectors: number;
  collectors_today: number;
  active_coolers: number;
  coolers_online: number;
  sms_available: number;
  sms_reserved: number;
  sms_success_rate_30d: number | null;
  sms_sent_30d: number;
  sms_failed_30d: number;
  pending_corrections: number;
  pending_payments: number;
  pending_payments_amount: number;
  cooler_alerts_24h: number;
}

export interface DashboardCharts {
  trend: { date: string; kg: number; farmers: number; sms_sent: number; sms_failed: number }[];
  coolers: { id: string; name: string; code: string; kg_30d: number }[];
  top_farmers: { id: string; name: string; farmer_number: string; kg_30d: number }[];
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
  /** The farmer has a MilkOS app account (pending or active). */
  has_account?: boolean;
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

export type AccountState = 'PENDING_APPROVAL' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface ActivationSummary {
  invited_at: string | null;
  link_sent_at: string | null;
  link_expires_at: string | null;
  link_state: 'NONE' | 'SENT' | 'OPENED' | 'EXPIRED' | 'USED' | 'REVOKED';
  /** Provider status of the last activation SMS. Never DELIVERED unless the provider confirmed delivery. */
  sms_status: string | null;
  sms_error: string | null;
  last_sms_attempt_at: string | null;
  phone_verified: boolean;
}

export interface SmsOutcome {
  sms_status: string;
  sms_sent: boolean;
  sms_error: string | null;
}

export interface TeamMember {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  phone_masked?: string;
  phone_verified?: boolean;
  role: 'COOP_ADMIN' | TeamRole | 'FARMER';
  is_active: boolean;
  account_status?: AccountState;
  status_reason?: string | null;
  is_you: boolean;
  last_login_at?: string | null;
  created_at: string | null;
  activation?: ActivationSummary | null;
  activation_sms?: SmsOutcome;
}

export interface TeamCreateInput {
  full_name: string;
  email: string | null;
  phone: string;
  role: TeamRole;
}

export interface TeamUpdateInput {
  full_name?: string;
  phone?: string;
  role?: TeamRole;
  is_active?: boolean;
}