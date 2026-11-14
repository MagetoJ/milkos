export interface CollectionReceiptData {
  receiptNo?: string;
  date?: string;
  collectorName?: string;
  farmerName?: string;
  farmerId?: string;
  route?: string;
  quantityLiters: number;
  fat?: number;
  snf?: number;
  totalAmount?: number;
  ratePerLiter?: number;
}

/**
 * Builds ESC/POS byte commands for printing collection receipts via Bluetooth thermal printers.
 */
export function buildCollectionReceiptBytes(data: CollectionReceiptData): Uint8Array {
  const encoder = new TextEncoder();
  const lines = [
    '\x1B\x40', // Initialize printer
    '\x1B\x61\x01', // Center alignment
    'DAIRYFLO COLLECTION RECEIPT\n',
    '--------------------------------\n',
    `Receipt No: ${data.receiptNo || 'N/A'}\n`,
    `Date: ${data.date || new Date().toLocaleString()}\n`,
    `Collector: ${data.collectorName || 'N/A'}\n`,
    `Farmer: ${data.farmerName || 'N/A'} (${data.farmerId || 'N/A'})\n`,
    `Route: ${data.route || 'N/A'}\n`,
    '--------------------------------\n',
    '\x1B\x61\x00', // Left alignment
    `Quantity: ${data.quantityLiters} Liters\n`,
    data.fat !== undefined ? `Fat: ${data.fat}%\n` : '',
    data.snf !== undefined ? `SNF: ${data.snf}%\n` : '',
    data.ratePerLiter ? `Rate/L: ${data.ratePerLiter}\n` : '',
    data.totalAmount ? `Total Amount: ${data.totalAmount}\n` : '',
    '--------------------------------\n',
    '\x1B\x61\x01', // Center alignment
    'Thank you for delivering with us!\n\n\n',
    '\x1D\x56\x00' // Cut paper command
  ];
  return encoder.encode(lines.join(''));
}
