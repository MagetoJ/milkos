// components/receipt/MilkCollectionReceipt.tsx

import React from 'react';
import { CollectionReceiptData } from '@/lib/printer/escpos-encoder';

export const MilkCollectionReceipt = React.forwardRef<HTMLDivElement, { data: CollectionReceiptData }>(
  ({ data }, ref) => {
    return (
      <div ref={ref} className="print-only-container p-4 w-[58mm] text-xs font-mono border bg-white">
        <style jsx global>{`
          @media print {
            body * { visibility: hidden; }
            .print-only-container, .print-only-container * { visibility: visible; }
            .print-only-container { position: absolute; left: 0; top: 0; width: 58mm; }
          }
        `}</style>
        <div className="text-center font-bold text-sm mb-1">{data.cooperativeName}</div>
        <div className="text-center text-[10px] uppercase mb-2">Milk Collection Receipt</div>
        <hr className="border-dashed my-1" />
        <div>Receipt #: {data.receiptNo}</div>
        <div>Date: {data.timestamp}</div>
        <div>Collector: {data.collectorName}</div>
        <hr className="border-dashed my-1" />
        <div>Farmer: {data.farmerName} ({data.farmerId})</div>
        <div>Session: {data.session}</div>
        <div className="font-bold my-1 text-sm">Weight: {data.weightKg.toFixed(2)} KG</div>
        {data.cumulativePeriodKg && (
          <div>Period Total: {data.cumulativePeriodKg.toFixed(2)} KG</div>
        )}
        <hr className="border-dashed my-1" />
        <div className="text-center mt-2 font-serif text-[10px]">Thank you for your delivery!</div>
      </div>
    );
  }
);

MilkCollectionReceipt.displayName = 'MilkCollectionReceipt';