'use client';

import React, { useState } from "react";
import { buildCollectionReceiptBytes, type CollectionReceiptData } from "@/lib/bluetooth/receipt-builder";

export interface PrintReceiptsProps {
  data?: CollectionReceiptData;
  draft?: any;
  cooperativeName?: string | null;
  collectorName?: string | null;
  reference?: string | null;
}

export function PrintReceipts({ draft, cooperativeName, collectorName, reference, data }: PrintReceiptsProps) {
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    try {
      setPrinting(true);
      const receiptData: CollectionReceiptData = data || {
        receiptNo: reference || draft?.reference || 'N/A',
        collectorName: collectorName || 'N/A',
        farmerName: draft?.farmerName || draft?.farmerId || 'N/A',
        quantityLiters: draft?.quantityLiters || 0,
        fat: draft?.fat,
        snf: draft?.snf,
        totalAmount: draft?.totalAmount,
      };
      const bytes = buildCollectionReceiptBytes(receiptData);
      console.log("Printing receipt bytes generated:", bytes);
    } catch (err) {
      console.error("Print failed", err);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <button 
      onClick={handlePrint}
      disabled={printing}
      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
    >
      {printing ? "Printing..." : "Print Receipt"}
    </button>
  );
}

export const PrintReceiptsButton = PrintReceipts;
