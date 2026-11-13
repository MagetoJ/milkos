"use client";

import React, { useState } from "react";
import { receiptsFromDraft, joinBytes } from "@/lib/collections/receipts";
import { buildCollectionReceiptBytes, type CollectionReceiptData } from "@/lib/bluetooth/receipt-builder";
import { concatBytes } from "@/lib/concat-bytes";

const MILK_KG_PER_LITRE = 1.03;

function resolveSession(session: string | undefined, timestamp: string | undefined): 'MORNING' | 'AFTERNOON' {
  if (session === 'MORNING' || session === 'AFTERNOON') return session;
  if (!timestamp) return 'MORNING';
  const hour = new Date(timestamp).getHours();
  return hour < 12 ? 'MORNING' : 'AFTERNOON';
}

interface PrintReceiptsProps {
  draft: any;
  cooperativeName?: string;
  collectorName?: string;
  reference?: string;
  onPrinted?: () => void;
}

export function PrintReceipts({ draft, cooperativeName, collectorName, reference, onPrinted }: PrintReceiptsProps) {
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const receipts = receiptsFromDraft(draft, { cooperativeName, collectorName, reference });
      
      const payload = concatBytes(
        receipts.map((receipt) =>
          buildCollectionReceiptBytes({
            ...receipt,
            cooperativeName: receipt.cooperativeName ?? '',
            collectorName: receipt.collectorName ?? '',
            session: resolveSession(receipt.session, receipt.timestamp),
            weightKg:
              receipt.weightKg ?? Math.round(receipt.liters * MILK_KG_PER_LITRE * 100) / 100,
          })
        )
      );

      // Send payload to bluetooth printer writer here
      if (onPrinted) onPrinted();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Printing failed';
      alert(`Printing failed: ${msg}`);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <button
      onClick={handlePrint}
      disabled={printing}
      className="px-4 py-2 bg-emerald-600 text-white rounded shadow hover:bg-emerald-700 disabled:opacity-50"
    >
      {printing ? 'Printing...' : 'Print Receipts'}
    </button>
  );
}
