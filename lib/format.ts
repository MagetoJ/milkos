/** FastAPI returns naive UTC datetimes (no "Z"); treat them as UTC, not local time. */
export function parseServerDate(value: string): Date {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

export function timeAgo(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - parseServerDate(value).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** How long something has been waiting, used to flag overdue reviews. */
export type WaitTone = 'fresh' | 'due' | 'overdue';

export function waitTone(value: string, now = Date.now()): WaitTone {
  const hours = (now - parseServerDate(value).getTime()) / 3_600_000;
  if (hours >= 72) return 'overdue';
  if (hours >= 24) return 'due';
  return 'fresh';
}

export function waitingFor(value: string, now = Date.now()): string {
  const hours = Math.max(0, (now - parseServerDate(value).getTime()) / 3_600_000);
  if (hours < 1) return 'Under an hour';
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const number = new Intl.NumberFormat('en-KE');
export const formatNumber = (n: number | undefined | null) => number.format(n ?? 0);
export const formatKes = (n: number | undefined | null) => `KES ${number.format(n ?? 0)}`;

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '–';
  return parseServerDate(value).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const decimal = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 1 });
export const formatLitres = (n: number | undefined | null) => `${decimal.format(n ?? 0)} L`;
export const formatPercent = (n: number | undefined | null) => (n == null ? '–' : `${decimal.format(n)}%`);

/** Calendar date ("2026-10-03" or a timestamp) as "3 Oct 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '–';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : parseServerDate(value);
  return Number.isNaN(date.getTime())
    ? '–'
    : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** +254712345678 -> 0712 345 678 (how people write Kenyan numbers). */
export function formatPhone(value: string | null | undefined): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(value ?? '');
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : (value ?? '');
}

/** ACTION_NAME -> "Action name". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/[_.]/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Today's date as YYYY-MM-DD in local time (for <input type="date">). */
export function isoDay(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** +254712345656 -> 0712••••56 (the same rule as the backend's core.validation.mask_phone_local). */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) digits = `0${digits.slice(3)}`;
  if (digits.length < 7) return '••••';
  return `${digits.slice(0, 4)}${'•'.repeat(digits.length - 6)}${digits.slice(-2)}`;
}
