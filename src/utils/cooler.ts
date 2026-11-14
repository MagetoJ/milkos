export function coolerStatus(cooler: { status: string; is_operational: boolean }): string {
  if (cooler.status === 'ACTIVE' && cooler.is_operational) return 'online';
  if (cooler.status === 'ACTIVE' && !cooler.is_operational) return 'maintenance';
  return 'offline';
}
