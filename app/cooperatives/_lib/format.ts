const number = new Intl.NumberFormat('en-KE');

export const formatNumber = (n: number | null | undefined) => number.format(n ?? 0);

/** The API sends UTC timestamps ending in "Z". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** +254712345678 -> 0712 345 678 (how people write Kenyan numbers). */
export function formatPhone(value: string | null | undefined): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(value ?? '');
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : (value ?? '');
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}