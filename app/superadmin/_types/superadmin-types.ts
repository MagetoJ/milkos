export interface SuperadminStats {
  total_cooperatives: number;
  total_coolers: number;
  total_farmers: number;
  milk_today_kg: number;
  pending_applications_count: number;
  pending_payments_count: number;
  sms_credits_system_balance?: number;
}

export interface CooperativeApplication {
  id: string;
  org_name: string;
  applicant_name: string;
  email: string;
  phone: string;
  location: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

export interface PaymentVerificationItem {
  id: string;
  cooperative_id?: string | null;
  cooperative_name?: string | null;
  package_name?: string | null;
  amount_kes: number;
  credits_requested: number;
  masked_mpesa_ref: string;
  submitted_at: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string;
  admin_email?: string | null;
  created_at: string;
}

/** One thing waiting for a superadmin decision, whatever its source. */
export type QueueItem =
  | { kind: 'application'; id: string; title: string; subtitle: string; submittedAt: string; data: CooperativeApplication }
  | { kind: 'payment'; id: string; title: string; subtitle: string; submittedAt: string; data: PaymentVerificationItem };

export type QueueFilter = 'all' | QueueItem['kind'];
export type Decision = 'approve' | 'reject';
