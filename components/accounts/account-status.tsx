'use client';

// How an account's sign-in state is shown to administrators: status, activation progress and SMS outcome.
// SMS wording never claims more than the provider confirmed: "Sent" = accepted by the provider, "Delivered" only
// after a delivery report.
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

export type AccountState = 'PENDING_APPROVAL' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface Activation {
  invited_at: string | null;
  link_sent_at: string | null;
  link_expires_at: string | null;
  link_state: string;
  sms_status: string | null;
  sms_error: string | null;
  last_sms_attempt_at: string | null;
  phone_verified: boolean;
}

const STATE: Record<AccountState, { label: string; tone: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'bg-mo-info-soft text-mo-info' },
  PENDING_ACTIVATION: { label: 'Pending activation', tone: 'bg-mo-warn-soft text-mo-warn' },
  ACTIVE: { label: 'Active', tone: 'bg-mo-brand-soft text-mo-brand' },
  SUSPENDED: { label: 'Suspended', tone: 'bg-mo-danger-soft text-mo-danger' },
  DISABLED: { label: 'Disabled', tone: 'bg-mo-hover text-mo-muted' },
};

export const SMS_LABEL: Record<string, string> = {
  PENDING: 'Queued',
  PENDING_PROVIDER: 'Not sent: SMS provider not configured',
  RESERVED: 'Sending',
  SENDING: 'Sending',
  SENT: 'Sent (accepted by the SMS provider)',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  REFUNDED: 'Failed (credit refunded)',
  SKIPPED: 'Not sent',
  EXPIRED: 'Link expired',
};

export function accountState(row: { account_status?: string | null; is_active?: boolean }): AccountState {
  const s = row.account_status as AccountState | undefined;
  if (s && s in STATE) return s;
  return row.is_active ? 'ACTIVE' : 'DISABLED';
}

export function AccountStatusBadge({ state }: { state: AccountState }) {
  const { label, tone } = STATE[state];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>;
}

export function PhoneVerified({ verified }: { verified?: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 text-xs text-mo-brand"><ShieldCheck aria-hidden className="size-3.5" />Verified</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-mo-warn"><ShieldAlert aria-hidden className="size-3.5" />Not verified</span>
  );
}

/** One-line activation detail for a pending account (invitation date, link state, SMS outcome, expiry). */
export function ActivationLine({ activation }: { activation?: Activation | null }) {
  if (!activation) return null;
  const expired = activation.link_state === 'EXPIRED';
  const sms = activation.sms_status ? SMS_LABEL[activation.sms_status] ?? activation.sms_status : 'No SMS yet';
  const failed = ['FAILED', 'REFUNDED', 'PENDING_PROVIDER'].includes(activation.sms_status ?? '');
  return (
    <span className={`block text-xs ${failed || expired ? 'text-mo-danger' : 'text-mo-muted'}`}>
      Invited {activation.invited_at ? formatDateTime(activation.invited_at) : '–'} · SMS: {sms}
      {failed && activation.sms_error ? ` (${activation.sms_error})` : ''}
      {activation.link_expires_at && !expired ? ` · link expires ${formatDateTime(activation.link_expires_at)}` : ''}
      {expired ? ' · link expired' : ''}
      {activation.link_state === 'OPENED' ? ' · link opened' : ''}
    </span>
  );
}

/** What to tell the administrator right after an activation SMS was attempted. */
export function smsOutcomeMessage(outcome?: { sms_sent: boolean; sms_status: string; sms_error: string | null } | null): { ok: boolean; text: string } {
  if (!outcome) return { ok: true, text: '' };
  if (outcome.sms_sent) return { ok: true, text: 'Activation SMS accepted by the provider. Delivery depends on the phone network.' };
  return {
    ok: false,
    text: `The activation SMS could not be sent${outcome.sms_error ? `: ${outcome.sms_error}` : ''}. The account is saved; fix the problem and use "Resend link".`,
  };
}
