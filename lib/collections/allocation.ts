// Allocation arithmetic for a collection batch. All sums are done in hundredths of a KG (integers), the
// precision the server stores, so 0.1 + 0.2 style float errors can never let an over-allocation through or
// block a valid one. The server re-checks every rule (backend services/batches.check_allocation).

export interface AllocationLine {
  /** Device-generated id of the allocation line (reused by the server). */
  line_id: string;
  farmer_id: string;
  farmer_name: string;
  farmer_number: string;
  phone?: string | null;
  /** As typed: may be empty or invalid while the collector is editing. */
  quantity_kg: string;
}

/** green = all allocated, amber = some remains, red = more than the total, empty = nothing yet. */
export type AllocationState = 'empty' | 'valid' | 'remaining' | 'over';

export const toCents = (kg: number) => Math.round(kg * 100);
export const fromCents = (cents: number) => cents / 100;

/** Parsed KG of a typed value, or null if it isn't a positive number with at most 2 decimals. */
export function parseKg(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const kg = Number(text);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

export interface AllocationSummary {
  totalCents: number;
  allocatedCents: number;
  remainingCents: number;
  state: AllocationState;
  /** Lines whose quantity isn't a valid positive number. */
  invalidLines: string[];
}

export function summarize(totalKg: number | null, lines: AllocationLine[]): AllocationSummary {
  const totalCents = totalKg && totalKg > 0 ? toCents(totalKg) : 0;
  let allocatedCents = 0;
  const invalidLines: string[] = [];
  for (const line of lines) {
    const kg = parseKg(line.quantity_kg);
    if (kg === null) invalidLines.push(line.line_id);
    else allocatedCents += toCents(kg);
  }
  const remainingCents = totalCents - allocatedCents;
  const state: AllocationState =
    allocatedCents <= 0 ? 'empty' : remainingCents < 0 ? 'over' : remainingCents === 0 ? 'valid' : 'remaining';
  return { totalCents, allocatedCents, remainingCents, state, invalidLines };
}

export interface ConfirmInput {
  totalKg: number | null;
  lines: AllocationLine[];
  coolerId: string | null;
  weightSource: string | null;
}

/** Everything that stops a batch from being confirmed (empty = ready). */
export function confirmBlockers({ totalKg, lines, coolerId, weightSource }: ConfirmInput): string[] {
  const out: string[] = [];
  if (!coolerId) out.push('Choose the cooler.');
  if (!totalKg || totalKg <= 0 || !weightSource) out.push('Capture the total weight.');
  if (lines.length === 0) out.push('Add at least one farmer.');
  const ids = lines.map((l) => l.farmer_id);
  if (new Set(ids).size !== ids.length) out.push('Each farmer can appear only once.');
  const s = summarize(totalKg, lines);
  if (s.invalidLines.length) out.push('Enter a KG amount above 0 (at most 2 decimals) for every farmer.');
  if (s.allocatedCents <= 0 && lines.length) out.push('Allocate some of the weight.');
  if (s.state === 'over') out.push(`Allocated weight is ${fromCents(-s.remainingCents).toFixed(2)} KG more than the total.`);
  return out;
}

/** Split what remains onto one line (convenience for the last farmer). */
export function fillRemaining(totalKg: number | null, lines: AllocationLine[], lineId: string): AllocationLine[] {
  const others = lines.filter((l) => l.line_id !== lineId);
  const remaining = summarize(totalKg, others).remainingCents;
  if (remaining <= 0) return lines;
  return lines.map((l) => (l.line_id === lineId ? { ...l, quantity_kg: fromCents(remaining).toFixed(2) } : l));
}

export const formatKg = (kg: number | null | undefined) =>
  `${(kg ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
