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

export function formatDateTime(value: string): string {
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
