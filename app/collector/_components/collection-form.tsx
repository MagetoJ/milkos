import { useState } from 'react';
import { buildCollectionReceiptBytes, CollectionReceiptData } from '@/lib/printer/escpos-encoder';
import { printToBluetoothPrinter } from '@/lib/printer/web-bluetooth-printer';

export function IntakeCollectionAction({ currentEntry }: { currentEntry: CollectionReceiptData }) {
  const [isPrinting, setIsPrinting] = useState(false);

  async function handleBluetoothPrint() {
    try {
      setIsPrinting(true);
      const bytes = buildCollectionReceiptBytes(currentEntry);
      await printToBluetoothPrinter(bytes);
      alert('Receipt printed successfully!');
    } catch (err: unknown) {
      console.error('Print Error:', err);
      alert(`Printing failed: ${err.message}`);
    } finally {
      setIsPrinting(false);
    }
  }

  function handleStandardPrint() {
    window.print();
  }

  return (
    <div className="flex gap-2 mt-4">
      <button
        onClick={handleBluetoothPrint}
        disabled={isPrinting}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isPrinting ? 'Printing...' : 'Print ESC/POS (Bluetooth)'}
      </button>

      <button
        onClick={handleStandardPrint}
        className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
      >
        Print (System Browser)
      </button>
    </div>
  );
}