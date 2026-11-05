'use client';

// "Print receipts" on the collection-confirmed screen: one slip per farmer, sent to the paired Bluetooth printer.
// Standalone on purpose (no Bluetooth provider needed): it only appears in browsers that support Web Bluetooth,
// and reports success or failure on the screen instead of in a browser alert.
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { isBluetoothSupported } from '@/lib/bluetooth/capability';
import type { CollectionDraft } from '@/lib/collections/draft';
import { buildCollectionReceiptBytes } from '@/lib/printer/escpos-encoder';
import { printToBluetoothPrinter } from '@/lib/printer/printer-service';
import { joinBytes, receiptsFromDraft } from '@/lib/printer/receipts';
import { Button } from './ui';

export function PrintReceiptsButton({
  draft,
  cooperativeName,
  collectorName,
  reference,
}: {
  draft: CollectionDraft;
  cooperativeName: string | null;
  collectorName: string | null;
  reference: string | null;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setSupported(isBluetoothSupported()), []);

  const receipts = receiptsFromDraft(draft, { cooperativeName, collectorName, reference });
  if (!supported || receipts.length === 0) return null;

  async function print() {
    setBusy(true);
    setStatus(null);
    try {
      const sent = await printToBluetoothPrinter(joinBytes(receipts.map(buildCollectionReceiptBytes)));
      if (sent) setStatus({ ok: true, text: `Sent ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} to the printer.` });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'Printing failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => void print()} disabled={busy}>
        <Printer aria-hidden className="size-5" /> {busy ? 'Printing…' : `Print receipt${receipts.length === 1 ? '' : 's'} (Bluetooth)`}
      </Button>
      {status && (
        <p role="status" className={`text-sm ${status.ok ? 'text-[#124D37]' : 'text-[#912018]'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
