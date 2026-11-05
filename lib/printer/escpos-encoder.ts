// lib/printer/escpos-encoder.ts

export interface CollectionReceiptData {
  receiptNo: string;
  timestamp: string;
  cooperativeName: string;
  collectorName: string;
  farmerId: string;
  farmerName: string;
  session: 'Morning' | 'Evening';
  weightKg: number;
  ratePerKg?: number;
  totalAmount?: number;
  cumulativePeriodKg?: number;
}

export class ESCPOSBuilder {
  private buffer: number[] = [];

  init(): this {
    this.buffer.push(0x1b, 0x40);
    return this;
  }

  align(alignment: 0 | 1 | 2): this {
    this.buffer.push(0x1b, 0x61, alignment);
    return this;
  }

  bold(enable: boolean): this {
    this.buffer.push(0x1b, 0x45, enable ? 1 : 0);
    return this;
  }

  text(str: string): this {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    bytes.forEach((b) => this.buffer.push(b));
    return this;
  }

  lineFeed(lines: number = 1): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0a);
    }
    return this;
  }

  divider(cols: number = 32): this {
    return this.text('-'.repeat(cols)).lineFeed();
  }

  cut(): this {
    this.buffer.push(0x1d, 0x56, 0x41, 0x10);
    return this;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

export function buildCollectionReceiptBytes(data: CollectionReceiptData): Uint8Array {
  const builder = new ESCPOSBuilder();

  builder
    .init()
    .align(1)
    .bold(true)
    .text(data.cooperativeName)
    .lineFeed()
    .bold(false)
    .text("MILK COLLECTION RECEIPT")
    .lineFeed()
    .divider()
    .align(0)
    .text(`Receipt #: ${data.receiptNo}`)
    .lineFeed()
    .text(`Date: ${data.timestamp}`)
    .lineFeed()
    .text(`Collector: ${data.collectorName}`)
    .lineFeed()
    .divider()
    .text(`Farmer: ${data.farmerName} (${data.farmerId})`)
    .lineFeed()
    .text(`Session: ${data.session}`)
    .lineFeed()
    .bold(true)
    .text(`Weight Delivered: ${data.weightKg.toFixed(2)} KG`)
    .lineFeed()
    .bold(false);

  // Narrow optional types to satisfy TypeScript strict null checks
  const ratePerKg = data.ratePerKg;
  const totalAmount = data.totalAmount;
  if (ratePerKg !== undefined && totalAmount !== undefined) {
    builder
      .text(`Rate/KG: KES ${ratePerKg.toFixed(2)}`)
      .lineFeed()
      .text(`Est. Total: KES ${totalAmount.toFixed(2)}`)
      .lineFeed();
  }

  const cumulativePeriodKg = data.cumulativePeriodKg;
  if (cumulativePeriodKg !== undefined) {
    builder
      .text(`Period Total: ${cumulativePeriodKg.toFixed(2)} KG`)
      .lineFeed();
  }

  // Calling .getBytes() returns the Uint8Array expected by the signature
  return builder
    .divider()
    .align(1)
    .text("Thank you for your delivery!")
    .lineFeed(3)
    .cut()
    .getBytes();
}