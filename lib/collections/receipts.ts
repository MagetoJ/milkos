// What to tell a collector about a farmer's SMS receipt. "Sent" is shown ONLY when the server recorded that
// the SMS provider accepted the message; offline, nothing has been sent yet and the screen says so.
import type { RecordSyncStatus } from '@/lib/offline/types';

export type ReceiptTone = 'green' | 'amber' | 'red' | 'grey' | 'blue';

export interface ReceiptLabel {
  label: string;
  tone: ReceiptTone;
  /** Explanation for screen readers / tooltips. */
  detail: string;
}

export function receiptLabel(
  receiptStatus: string | null | undefined,
  recordSync: RecordSyncStatus | null | undefined,
  receiptsWanted = true,
): ReceiptLabel {
  if (!receiptsWanted) return { label: 'No SMS', tone: 'grey', detail: 'SMS receipts were switched off for this collection.' };
  if (recordSync && recordSync !== 'synced') {
    return { label: 'Queued', tone: 'amber', detail: 'Saved on this device. The SMS receipt is sent after the collection syncs.' };
  }
  switch (receiptStatus) {
    case 'SENT':
      return { label: 'SMS sent', tone: 'green', detail: 'The SMS provider accepted the receipt.' };
    case 'PENDING':
    case 'RESERVED':
    case 'SENDING':
      return { label: 'Sending…', tone: 'blue', detail: 'The receipt is being handed to the SMS provider.' };
    case 'PENDING_PROVIDER':
      return { label: 'Waiting for SMS provider', tone: 'amber', detail: 'No SMS provider is configured yet. The receipt is kept and not sent.' };
    case 'FAILED':
      return { label: 'SMS failed', tone: 'red', detail: 'The last attempt failed. It is retried automatically while attempts remain.' };
    case 'REFUNDED':
      return { label: 'SMS not sent', tone: 'red', detail: 'Delivery was given up and the SMS credit was refunded.' };
    case 'SKIPPED':
      return { label: 'Not sent', tone: 'grey', detail: 'The receipt was not sent (receipts off, or the collection was changed first).' };
    default:
      return { label: 'No SMS', tone: 'grey', detail: 'No receipt was created (receipts off or no phone number).' };
  }
}

/** One line for a whole batch: e.g. "2 of 3 SMS sent". */
export function receiptSummary(statuses: (string | null | undefined)[], recordSync: RecordSyncStatus | null | undefined): string {
  if (recordSync && recordSync !== 'synced') return 'SMS receipts queued until this collection syncs';
  if (statuses.length === 0) return 'No SMS receipts';
  const sent = statuses.filter((s) => s === 'SENT').length;
  const waiting = statuses.filter((s) => s === 'PENDING' || s === 'RESERVED' || s === 'SENDING' || s === 'PENDING_PROVIDER').length;
  const failed = statuses.filter((s) => s === 'FAILED' || s === 'REFUNDED').length;
  const parts = [`${sent} of ${statuses.length} SMS sent`];
  if (waiting) parts.push(`${waiting} waiting`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}
