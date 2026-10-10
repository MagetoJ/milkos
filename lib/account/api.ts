// Personal account settings (/api/v1/account) and the public account flows (/api/v1/auth: activation, password
// reset, two-step sign-in). Every call here acts on the signed-in account only; the server decides what each role
// may change. Security operations are online-only: they're never queued for offline sync.
import { ApiError, createApi, readError, send } from '@/lib/api-client';
import { saveToken } from '@/lib/auth';
import type { UserRole } from '@/lib/auth';

const request = createApi('/api/v1/account');

export type AccountStatus = 'PENDING_APPROVAL' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface AccountProfile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  phone_masked: string;
  phone_verified: boolean;
  phone_verified_at: string | null;
  role: UserRole;
  account_status: AccountStatus;
  must_change_password: boolean;
  password_set_at: string | null;
  mfa_enabled: boolean;
  mfa_enabled_at: string | null;
  recovery_codes_left: number;
  activated_at: string | null;
  created_at: string | null;
  last_login_at: string | null;
  cooperative: { id: string; name: string; code: string; status: string } | null;
  profile: Record<string, string | number | null>;
  editable: { full_name: boolean; email: boolean; email_required: boolean; phone: boolean };
  permissions: string[];
  access_token?: string;
}

export interface NotificationPreference {
  key: string;
  label: string;
  help: string;
  mandatory: boolean;
  enabled: boolean;
}

export interface Preferences {
  notifications: NotificationPreference[];
  work: Record<string, string | boolean | null>;
}

export interface SessionInfo {
  id: string;
  device_id: string;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  user_agent: string | null;
  signed_in_at: string | null;
  last_active_at: string | null;
  last_sync_at: string | null;
  expires_at: string | null;
  device_active: boolean;
  current: boolean;
}

export interface SecurityEvent {
  id: string;
  action: string;
  label: string;
  actor_email: string | null;
  actor_role: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  created_at: string | null;
}

export interface SmsOutcome {
  sms_status: string;
  sms_sent: boolean;
  sms_error: string | null;
}

export interface CodeSent extends SmsOutcome {
  verification_id: string;
  phone_masked: string;
  expires_in_seconds: number;
  resend_after_seconds: number;
}

/** Keep the token the server re-issued after a session change (password, phone, sign out others). */
function keep<T extends { access_token?: string | null }>(result: T): T {
  if (result?.access_token) saveToken(result.access_token);
  return result;
}

export const getAccount = () => request<AccountProfile>('/me');
export const updateProfile = (data: { full_name?: string; email?: string | null; clear_email?: boolean; current_password?: string }) =>
  request<AccountProfile>('/profile', send('PATCH', data));
export const changePassword = async (current_password: string, new_password: string, device_identifier?: string | null) =>
  keep(await request<{ changed: boolean; access_token: string }>('/password', send('POST', { current_password, new_password, device_identifier })));
export const getPreferences = () => request<Preferences>('/preferences');
export const savePreferences = (data: { notifications?: Record<string, boolean>; work?: Record<string, unknown> }) =>
  request<Preferences>('/preferences', send('PUT', data));
export const requestPhoneChange = (phone: string, password: string) => request<CodeSent>('/phone/change', send('POST', { phone, password }));
export const requestPhoneVerification = () => request<CodeSent>('/phone/verify-current', send('POST'));
export const confirmPhone = async (verification_id: string, code: string, device_identifier?: string | null) =>
  keep(await request<AccountProfile>('/phone/confirm', send('POST', { verification_id, code, device_identifier })));
export const listSessions = (device_identifier?: string | null) =>
  request<SessionInfo[]>(`/sessions${device_identifier ? `?device_identifier=${encodeURIComponent(device_identifier)}` : ''}`);
export const revokeSession = async (id: string, device_identifier?: string | null) =>
  keep(await request<{ revoked: boolean; signed_out_here: boolean; access_token: string | null }>(
    `/sessions/${id}${device_identifier ? `?device_identifier=${encodeURIComponent(device_identifier)}` : ''}`, send('DELETE'),
  ));
export const revokeOtherSessions = async (device_identifier?: string | null) =>
  keep(await request<{ revoked: number; access_token: string }>('/sessions/revoke-others', send('POST', { device_identifier })));
export const getSecurityEvents = (limit = 30) => request<SecurityEvent[]>(`/security-events?limit=${limit}`);
export const startMfa = (password: string) => request<{ secret: string; otpauth_uri: string }>('/mfa/setup', send('POST', { password }));
export const enableMfa = (code: string) => request<{ enabled: boolean; recovery_codes: string[] }>('/mfa/enable', send('POST', { code }));
export const disableMfa = (password: string, code: string) => request<{ enabled: boolean }>('/mfa/disable', send('POST', { password, code }));
export const newRecoveryCodes = (password: string, code: string) =>
  request<{ recovery_codes: string[] }>('/mfa/recovery-codes', send('POST', { password, code }));

// ---------------- public flows (no session) ----------------

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/auth${path}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach MilkOS. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw readError(res.status, data);
  return data as T;
}

export type LinkState = 'VALID' | 'INVALID' | 'EXPIRED' | 'USED' | 'REVOKED';

export interface ActivationView {
  state: LinkState;
  can_request_new_link: boolean;
  full_name?: string;
  role?: UserRole;
  cooperative_name?: string | null;
  phone_masked?: string;
  expires_at?: string;
  requires_otp?: boolean;
  otp_verified?: boolean;
}

export const inspectActivation = (token: string) => publicPost<ActivationView>('/activation/inspect', { token });
export const sendActivationCode = (token: string) =>
  publicPost<SmsOutcome & { message: string; resend_after_seconds: number; expires_in_seconds: number }>('/activation/send-code', { token });
export const verifyActivationCode = (token: string, code: string) => publicPost<{ verified: boolean }>('/activation/verify-code', { token, code });
export const completeActivation = (token: string, password: string) =>
  publicPost<{ activated: boolean; role: UserRole; message: string }>('/activation/complete', { token, password });
export const resendActivation = (data: { token?: string; identifier?: string }) => publicPost<{ message: string }>('/activation/resend', data);
export const requestPasswordReset = (identifier: string) => publicPost<{ message: string }>('/password-reset/request', { identifier });
export const inspectReset = (token: string) => publicPost<{ state: LinkState; phone_masked?: string; expires_at?: string }>('/password-reset/inspect', { token });
export const completeReset = (token: string, password: string) => publicPost<{ reset: boolean; message: string }>('/password-reset/complete', { token, password });
export const verifyMfaLogin = (mfa_token: string, code: string) =>
  publicPost<{ access_token: string; role: UserRole; user_id: string; must_change_password: boolean }>('/mfa/verify', { mfa_token, code });

/** The one-time token from an SMS link. It travels in the URL fragment (#t=...), which is never sent to a server. */
export function tokenFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return hash.get('t') ?? '';
}

/** Remove the token from the address bar and history once read, so it isn't left on screen or in history. */
export function forgetTokenInLocation(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export const PASSWORD_RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'An uppercase letter' },
  { test: (v: string) => /[a-z]/.test(v), label: 'A lowercase letter' },
  { test: (v: string) => /\d/.test(v), label: 'A number' },
];

export const passwordProblems = (value: string) => PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.label);
