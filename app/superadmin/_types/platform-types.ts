// Shapes returned by /api/v1/superadmin/* (see backend/routers/superadmin and backend/services).
import type { UserRole } from '@/lib/auth';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export type ActiveStatus = 'ACTIVE' | 'INACTIVE';
export type CooperativeStatus = 'ACTIVE' | 'SUSPENDED';
export type QualityStatus = 'ACCEPTED' | 'REJECTED' | 'PENDING';
export type PaymentStatus = 'PENDING' | 'AWAITING_INFORMATION' | 'VERIFIED' | 'REJECTED' | 'CANCELLED';

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target: string;
  entity_type: string | null;
  entity_id: string | null;
  cooperative_id: string | null;
  cooperative_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  admin_email?: string | null;
}

export interface Dashboard {
  cooperatives: { total: number; active: number; suspended: number };
  users: {
    total: number;
    active: number;
    superadmins: number;
    coop_admins: number;
    managers: number;
    collector_accounts: number;
    farmer_accounts: number;
  };
  farmers: { total: number; active: number };
  collectors: { total: number; active: number };
  coolers: { total: number; operational: number; offline: number };
  milk: { today: number; week: number; month: number; collections_today: number; daily: { date: string; litres: number }[] };
  pending: { applications: number; payments: number; payment_credits: number; payment_amount_kes: number };
  sms: { total_balance: number; low_balance_cooperatives: number };
  top_cooperatives: { id: string; name: string; code: string; litres_30d: number }[];
  recent_activity: AuditEntry[];
  generated_at: string;
}

export interface CooperativeCounts {
  farmers: number;
  collectors: number;
  managers: number;
  admins: number;
  coolers: number;
  litres_30d: number;
  centres?: number;
}

export interface Cooperative {
  id: string;
  name: string;
  code: string;
  registration_number: string;
  kra_pin: string;
  county: string;
  location: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: CooperativeStatus;
  suspension_reason: string | null;
  suspended_at: string | null;
  sms_credit_balance: number;
  estimated_daily_liters: number | null;
  created_at: string | null;
  updated_at: string | null;
  counts?: CooperativeCounts;
}

export interface CooperativeDetail extends Cooperative {
  counts: CooperativeCounts;
  administrators: { id: string; full_name: string; email: string; phone_number: string; is_active: boolean; last_login_at: string | null }[];
  milk: { today: number; week: number; month: number; collections_today: number };
  payments: { pending: number; verified: number; rejected: number; verified_amount_kes: number };
  recent_activity: AuditEntry[];
}

export interface CooperativeInput {
  name?: string;
  registration_number?: string;
  kra_pin?: string;
  county?: string;
  location?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  estimated_daily_liters?: number | null;
  admin?: { full_name: string; email: string; phone: string } | null;
}

export interface PlatformUser {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  phone_masked?: string;
  phone_verified?: boolean;
  role: UserRole;
  is_active: boolean;
  account_status?: 'PENDING_APPROVAL' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  status_reason?: string | null;
  mfa_enabled?: boolean;
  invited_at?: string | null;
  activated_at?: string | null;
  activation?: {
    invited_at: string | null; link_sent_at: string | null; link_expires_at: string | null; link_state: string;
    sms_status: string | null; sms_error: string | null; last_sms_attempt_at: string | null; phone_verified: boolean;
  } | null;
  activation_sms?: { sms_status: string; sms_sent: boolean; sms_error: string | null };
  cooperative_id: string | null;
  cooperative_name: string | null;
  cooperative_code: string | null;
  last_login_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PlatformUserDetail extends PlatformUser {
  permissions: string[];
  activity: AuditEntry[];
}

export interface UserInput {
  full_name?: string;
  email?: string | null;
  phone?: string;
  role?: UserRole;
  cooperative_id?: string | null;
  farmer_id?: string | null;
}

export interface Stats {
  total_litres: number;
  collections: number;
  last_collection: string | null;
}

export interface Farmer {
  id: string;
  cooperative_id: string;
  cooperative_name?: string;
  cooperative_code?: string;
  farmer_number: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  national_id: string | null;
  village: string | null;
  number_of_cows: number | null;
  payment_method: 'MPESA' | 'BANK' | null;
  payment_account: string | null;
  bank_name: string | null;
  status: ActiveStatus;
  centre_id: string | null;
  centre_name: string | null;
  has_account: boolean;
  created_at: string | null;
  updated_at: string | null;
  stats: Stats;
}

export interface FarmerDetail extends Farmer {
  recent_collections: Collection[];
  activity: AuditEntry[];
  payments_supported: boolean;
}

export interface FarmerInput {
  cooperative_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  national_id?: string | null;
  village?: string | null;
  number_of_cows?: number | null;
  payment_method?: 'MPESA' | 'BANK' | null;
  payment_account?: string | null;
  bank_name?: string | null;
  farmer_number?: string;
  status?: ActiveStatus;
}

export interface Collector {
  id: string;
  user_id: string;
  cooperative_id: string;
  cooperative_name?: string;
  cooperative_code?: string;
  collector_number: string;
  full_name: string;
  email: string;
  phone: string;
  assigned_area: string | null;
  centre_id: string | null;
  centre_name: string | null;
  cooler_id: string | null;
  cooler_name: string | null;
  status: ActiveStatus;
  account_active: boolean;
  account_status?: 'PENDING_APPROVAL' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  phone_verified?: boolean;
  activation_sms?: { sms_status: string; sms_sent: boolean; sms_error: string | null };
  created_at: string | null;
  updated_at: string | null;
  stats: Stats;
}

export interface CollectorInput {
  cooperative_id?: string;
  full_name?: string;
  email?: string | null;
  phone?: string;
  collector_number?: string;
  assigned_area?: string | null;
  cooler_id?: string | null;
  status?: ActiveStatus;
}

export interface Cooler {
  id: string;
  cooperative_id: string;
  cooperative_name?: string;
  cooperative_code?: string;
  code: string;
  name: string;
  location: string | null;
  centre_id: string | null;
  centre_name: string | null;
  capacity_litres: number | null;
  scale_device_id: string | null;
  status: ActiveStatus;
  is_operational: boolean;
  last_temperature_c: number | null;
  last_reading_at: string | null;
  litres_today: number;
  // Cooler monitoring (offline-first foundation). Optional so older responses still type-check.
  manager_user_id?: string | null;
  manager_name?: string | null;
  current_volume_litres?: number | null;
  last_seen_at?: string | null;
  low_volume_alert_litres?: number | null;
  high_volume_alert_litres?: number | null;
  min_temperature_c?: number | null;
  max_temperature_c?: number | null;
  stale_after_minutes?: number | null;
  low_battery_percent?: number | null;
  alerts_enabled?: boolean;
  sensors?: SensorDevice[];
  /** Operational context (collections, scale, alerts). */
  kg_today?: number;
  collections_today?: number;
  collector_count?: number;
  scale?: { source: string; name: string | null; identifier: string | null; last_used_at: string | null } | null;
  battery_percent?: number | null;
  alerts_24h?: number;
  sensor_status?: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN' | null;
  sync_version?: number;
  sync_status?: SyncStatus;
  created_at: string | null;
  updated_at: string | null;
}

export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';

export interface SensorDevice {
  id: string;
  cooperative_id: string;
  cooperative_name?: string;
  cooler_id: string | null;
  cooler_name: string | null;
  sensor_identifier: string;
  name: string;
  sensor_type: string;
  transport: 'BLUETOOTH_LE' | 'NATIVE_BRIDGE' | 'SIMULATED';
  protocol: string | null;
  bluetooth_device_id: string | null;
  bluetooth_name: string | null;
  firmware_version: string | null;
  calibration: Record<string, unknown> | null;
  is_active: boolean;
  is_simulated: boolean;
  last_seen_at: string | null;
  last_connection_state: string | null;
  bound_at: string | null;
}

export interface CoolerReading {
  id: string;
  cooperative_id?: string;
  cooperative_name?: string;
  cooler_id: string;
  cooler_name?: string;
  cooler_code?: string;
  sensor_id: string | null;
  volume_litres: number | null;
  temperature_celsius: number | null;
  battery_percent: number | null;
  signal_strength: number | null;
  measured_at: string;
  received_at: string | null;
  source: 'BLUETOOTH' | 'NATIVE_BRIDGE' | 'MANUAL' | 'SIMULATED';
  quality: 'VALID' | 'SUSPICIOUS' | 'SIMULATED';
  quality_flags: string[];
  sync_status?: SyncStatus;
}

export interface AlertNotification {
  id: string;
  cooperative_id: string;
  cooperative_name?: string;
  cooler_id: string | null;
  recipient_phone: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  context: Record<string, unknown> | null;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  provider: string | null;
  attempts: number;
  error: string | null;
  created_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
}

export interface Device {
  id: string;
  device_identifier: string;
  cooperative_id: string | null;
  cooperative_name: string | null;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_sync_at: string | null;
  created_at: string | null;
}

export interface SyncHealth {
  generated_at: string;
  totals: { devices: number; active_sessions: number; applied_24h: number; open_conflicts: number; readings_24h: number; failed_notifications: number };
  cooperatives: {
    cooperative_id: string;
    cooperative_name: string;
    cooperative_code: string;
    devices: number;
    active_devices: number;
    last_sync_at: string | null;
    applied_24h: number;
    rejected_24h: number;
    conflicts_24h: number;
    open_conflicts: number;
    readings_24h: number;
    failed_notifications: number;
  }[];
}

export interface CoolerInput {
  cooperative_id?: string;
  name?: string;
  code?: string;
  location?: string | null;
  capacity_litres?: number | null;
  scale_device_id?: string | null;
  is_operational?: boolean;
  status?: ActiveStatus;
  manager_user_id?: string | null;
  low_volume_alert_litres?: number | null;
  high_volume_alert_litres?: number | null;
  min_temperature_c?: number | null;
  max_temperature_c?: number | null;
  stale_after_minutes?: number | null;
  low_battery_percent?: number | null;
  alerts_enabled?: boolean;
}

export interface Collection {
  id: string;
  reference: string;
  cooperative_id: string;
  cooperative_name: string;
  cooperative_code: string;
  farmer_id: string;
  farmer_name: string;
  farmer_number: string;
  collector_id: string | null;
  collector_name: string | null;
  collector_number: string | null;
  cooler_id: string | null;
  cooler_name: string | null;
  cooler_code: string | null;
  collection_date: string;
  collection_time: string | null;
  quantity_litres: number;
  /** Allocation line of a collection batch (absent on records created offline before syncing). */
  quantity_kg?: number | null;
  batch_id?: string | null;
  batch_reference?: string | null;
  batch_status?: string | null;
  weight_source?: 'SCALE' | 'MANUAL' | 'SIMULATED' | 'LITRES' | null;
  /** ACTIVE, or SUPERSEDED / REVERSED (kept for history, excluded from totals). */
  record_status?: 'ACTIVE' | 'SUPERSEDED' | 'REVERSED' | null;
  fat_percentage: number | null;
  snf_percentage: number | null;
  temperature_c: number | null;
  quality_status: QualityStatus;
  rejection_reason: string | null;
  notes: string | null;
  recorded_by: string | null;
  sync_version?: number;
  sync_status?: SyncStatus;
  sync_error?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CollectionSummary {
  collections: number;
  accepted_litres: number;
  accepted_kg?: number;
  rejected_collections: number;
  rejected_litres: number;
  average_fat_percentage: number | null;
}

export interface Payment {
  id: string;
  cooperative_id: string | null;
  cooperative_name: string | null;
  cooperative_code: string | null;
  package_id: string | null;
  package_name: string | null;
  amount_kes: number;
  credits_requested: number;
  masked_mpesa_ref: string;
  status: PaymentStatus;
  rejection_reason: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  info_request?: string | null;
  info_requested_at?: string | null;
  info_response?: string | null;
  info_responded_at?: string | null;
}

export interface PaymentDetail extends Payment {
  activity: AuditEntry[];
}

export interface PaymentSummary {
  pending: { count: number; amount_kes: number };
  awaiting_information?: { count: number; amount_kes: number };
  verified: { count: number; amount_kes: number };
  rejected: { count: number; amount_kes: number };
  cancelled?: { count: number; amount_kes: number };
}

export interface CollectionsReport {
  range: { from: string; to: string; days: number };
  cooperative_id: string | null;
  totals: {
    collections: number;
    accepted_litres: number;
    rejected_litres: number;
    rejected_collections: number;
    farmers_delivering: number;
    average_fat_percentage: number | null;
    average_snf_percentage: number | null;
    average_daily_litres: number;
  };
  daily: { date: string; accepted_litres: number; rejected_litres: number; collections: number }[];
  by_cooperative: {
    id: string;
    name: string;
    code: string;
    accepted_litres: number;
    rejected_litres: number;
    collections: number;
    farmers_delivering: number;
    average_fat_percentage: number | null;
  }[];
  top_farmers: { id: string; full_name: string; farmer_number: string; cooperative_name: string; accepted_litres: number; collections: number }[];
}

export type SearchType =
  | 'COOPERATIVE' | 'USER' | 'FARMER' | 'COLLECTOR' | 'COOLER' | 'COLLECTION'
  | 'BATCH' | 'FARMER_PAYMENT' | 'SMS_PAYMENT' | 'SMS_TRANSACTION' | 'APPLICATION' | 'CORRECTION' | 'REVERSAL'
  | 'DEVICE' | 'SCALE';

export interface SearchResult {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string;
  context: string | null;
  cooperative_id: string | null;
}

export interface Setting {
  key: string;
  value: unknown;
  default: unknown;
  type: 'boolean' | 'number' | 'integer' | 'email' | 'phone' | 'text';
  group: string;
  label: string;
  help: string;
  min: number | null;
  max: number | null;
  updated_at: string | null;
}

export interface SmsPackage {
  id: string;
  name: string;
  credits_amount: number;
  price_kes: number;
  is_active: boolean;
}

export interface RolesMatrix {
  permissions: string[];
  roles: Record<string, string[]>;
}
