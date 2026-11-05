import type { CollectionDraft } from "@/lib/collections/draft";
import type { RecordSyncStatus } from "@/lib/offline/types";

export type ReceiptTone = 'green' | 'amber' | 'red' | 'grey' | 'blue';

export interface ReceiptLabel {
  label: string;
  tone: ReceiptTone;
  /** Explanation for screen readers / tooltips. */
  detail: string;
}

export interface CollectionReceiptData {
  farmerId: string;
  farmerName: string;
  liters: number;
  weightKg?: number;
  canNumber?: string | null;
  timestamp: string;
  cooperativeName: string | null;
  collectorName: string | null;
  reference: string | null;
  receiptNo: string;
  session?: string;
}

export interface ReceiptMetaOptions {
  cooperativeName: string | null;
  collectorName: string | null;
  reference: string | null;
}

const RECEIPT_STATUS_MAP: Record<string, ReceiptLabel> = {
  SENT: {
    label: 'SMS sent',
    tone: 'green',
    detail: 'The SMS provider accepted the receipt.',
  },
  PENDING: {
    label: 'Sending…',
    tone: 'blue',
    detail: 'The receipt is being handed to the SMS provider.',
  },
  RESERVED: {
    label: 'Sending…',
    tone: 'blue',
    detail: 'The receipt is being handed to the SMS provider.',
  },
  SENDING: {
    label: 'Sending…',
    tone: 'blue',
    detail: 'The receipt is being handed to the SMS provider.',
  },
  PENDING_PROVIDER: {
    label: 'Waiting for SMS provider',
    tone: 'amber',
    detail: 'No SMS provider is configured yet. The receipt is kept and not sent.',
  },
  FAILED: {
    label: 'SMS failed',
    tone: 'red',
    detail: 'The last attempt failed. It is retried automatically while attempts remain.',
  },
  REFUNDED: {
    label: 'SMS not sent',
    tone: 'red',
    detail: 'Delivery was given up and the SMS credit was refunded.',
  },
  SKIPPED: {
    label: 'Not sent',
    tone: 'grey',
    detail: 'The receipt was not sent (receipts off, or the collection was changed first).',
  },
};

const DEFAULT_RECEIPT_LABEL: ReceiptLabel = {
  label: 'No SMS',
  tone: 'grey',
  detail: 'No receipt was created (receipts off or no phone number).',
};

export function receiptLabel(
  receiptStatus: string | null | undefined,
  recordSync: RecordSyncStatus | null | undefined,
  receiptsWanted = true,
): ReceiptLabel {
  if (!receiptsWanted) {
    return {
      label: 'No SMS',
      tone: 'grey',
      detail: 'SMS receipts were switched off for this collection.',
    };
  }

  if (recordSync && recordSync !== 'synced') {
    return {
      label: 'Queued',
      tone: 'amber',
      detail: 'Saved on this device. The SMS receipt is sent after the collection syncs.',
    };
  }

  if (!receiptStatus) return DEFAULT_RECEIPT_LABEL;

  return RECEIPT_STATUS_MAP[receiptStatus] ?? DEFAULT_RECEIPT_LABEL;
}

/** One line for a whole batch: e.g. "2 of 3 SMS sent". */
export function receiptSummary(
  statuses: (string | null | undefined)[],
  recordSync: RecordSyncStatus | null | undefined,
): string {
  if (recordSync && recordSync !== 'synced') {
    return 'SMS receipts queued until this collection syncs';
  }

  if (statuses.length === 0) return 'No SMS receipts';

  const countWhere = (predicate: (status: string) => boolean) =>
    statuses.reduce((acc, status) => (status && predicate(status) ? acc + 1 : acc), 0);

  const sent = countWhere((s) => s === 'SENT');
  const waiting = countWhere((s) =>
    ['PENDING', 'RESERVED', 'SENDING', 'PENDING_PROVIDER'].includes(s),
  );
  const failed = countWhere((s) => ['FAILED', 'REFUNDED'].includes(s));

  const parts = [`${sent} of ${statuses.length} SMS sent`];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);

  return parts.join(' · ');
}

export function joinBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function receiptsFromDraft(
  draft: CollectionDraft,
  meta: ReceiptMetaOptions
): CollectionReceiptData[] {
  const rawDraft = draft as Record<string, any>;
  const entries: any[] = rawDraft.entries || rawDraft.items || rawDraft.records || [];

  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const timestamp =
    rawDraft.createdAt ||
    rawDraft.date ||
    rawDraft.timestamp ||
    new Date().toISOString();

  return entries.map((entry: Record<string, any>, index: number) => {
    const liters = Number(entry.quantityLiters ?? entry.liters ?? entry.quantity ?? 0);
    return {
      farmerId: entry.farmerId || entry.farmerCode || "",
      farmerName: entry.farmerName || entry.name || "Unknown Farmer",
      liters,
      weightKg: entry.weightKg ?? liters * 1.03,
      canNumber: entry.canNumber ?? null,
      timestamp,
      cooperativeName: meta.cooperativeName,
      collectorName: meta.collectorName,
      reference: meta.reference,
      receiptNo: String(entry.receiptNo || `${meta.reference || "REC"}-${index + 1}`),
      session: entry.session || rawDraft.session || "MORNING",
    };
  });
}