import { humanize } from '@/lib/format';

type Tone = 'green' | 'grey' | 'red' | 'amber' | 'blue';

const TONES: Record<Tone, string> = {
  green: 'bg-mo-brand-soft text-mo-brand',
  grey: 'bg-mo-hover text-mo-muted',
  red: 'bg-mo-danger-soft text-mo-danger',
  amber: 'bg-mo-warn-soft text-mo-warn',
  blue: 'bg-mo-info-soft text-mo-info',
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  APPROVED: 'green',
  VERIFIED: 'green',
  ACCEPTED: 'green',
  ONLINE: 'green',
  INACTIVE: 'grey',
  DISABLED: 'grey',
  OFFLINE: 'amber',
  PENDING: 'amber',
  SUSPENDED: 'red',
  REJECTED: 'red',
};

/** Coloured pill for any status the API returns (ACTIVE, SUSPENDED, PENDING, ...). */
export function StatusBadge({ status, label, tone }: { status: string; label?: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone ?? STATUS_TONE[status] ?? 'grey']}`}>
      {label ?? humanize(status)}
    </span>
  );
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Superadmin',
  COOP_ADMIN: 'Coop admin',
  MANAGER: 'Manager',
  COLLECTOR: 'Collector',
  FARMER: 'Farmer',
};

export const roleLabel = (role: string | null | undefined) => (role ? ROLE_LABEL[role] ?? humanize(role) : '');

export function RoleBadge({ role }: { role: string }) {
  return <StatusBadge status={role} label={roleLabel(role)} tone={role === 'SUPER_ADMIN' ? 'blue' : 'grey'} />;
}
