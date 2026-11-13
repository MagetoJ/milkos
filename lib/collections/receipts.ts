export type Tone = 'green' | 'grey' | 'red' | 'amber' | 'blue';

export interface ReceiptLabelResult {
  label: string;
  detail?: string;
  tone?: Tone;
}

export function receiptLabel(
  status: string | null | undefined,
  syncStatus: string | null | undefined = 'synced',
  sendReceipts: boolean = true
): ReceiptLabelResult {
  if (sendReceipts === false) {
    return { label: 'No SMS', tone: 'grey' };
  }
  if (syncStatus === 'pending' || !status) {
    return { label: 'Queued', tone: 'amber' };
  }
  if (status === 'PENDING_PROVIDER') {
    return { label: 'Waiting for SMS provider', tone: 'amber' };
  }
  if (status === 'FAILED') {
    return { label: 'SMS failed', tone: 'red', detail: 'Failed to deliver SMS' };
  }
  if (status === 'REFUNDED') {
    return { label: 'SMS not sent', tone: 'grey' };
  }
  if (status === 'SENT') {
    return { label: 'SMS sent', tone: 'green' };
  }
  return { label: status, tone: 'grey' };
}

export function receiptSummary(
  statuses: (string | null | undefined)[],
  syncStatus: string | null | undefined = 'synced'
): string {
  if (syncStatus === 'pending') {
    return '1 of 1 queued';
  }
  const sent = statuses.filter(s => s === 'SENT').length;
  const waiting = statuses.filter(s => s === 'PENDING_PROVIDER').length;
  const failed = statuses.filter(s => s === 'FAILED').length;
  
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} of ${statuses.length} SMS sent`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);
  
  return parts.join(' · ') || 'All receipts processed';
}

export function joinBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function receiptsFromDraft(draft: any, meta?: any): any[] {
  if (!draft) return [];
  const items = Array.isArray(draft) ? draft : [draft];
  return items.map(item => ({
    receiptNo: item.receiptNo || item.id?.slice(0, 8) || '001',
    timestamp: item.timestamp || item.collection_date || new Date().toISOString(),
    farmerId: item.farmerId || item.farmer_id || 'F-001',
    farmerName: item.farmerName || item.farmer_name || 'Farmer',
    cooperativeName: meta?.cooperativeName || item.cooperativeName || 'Cooperative',
    collectorName: meta?.collectorName || item.collectorName || 'Collector',
    session: item.session || 'MORNING',
    liters: item.liters ?? item.quantity_litres ?? 0,
    weightKg: item.weightKg ?? item.quantity_litres ?? 0,
    ...item
  }));
}
