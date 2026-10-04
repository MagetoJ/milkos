// Validation applied on the device before a change is queued, mirroring the server's rules
// (backend/core/validation.py, schemas/cooperative_module.py, schemas/platform.py, schemas/sync.py) so
// offline users see mistakes immediately. The server re-validates everything when the change syncs.
import { ApiError } from '@/lib/api-client';

const PHONE_PATTERNS = [/^\+254([17]\d{8})$/, /^254([17]\d{8})$/, /^0([17]\d{8})$/, /^([17]\d{8})$/];
const CODE = /^[A-Z0-9][A-Z0-9\-_/]{1,49}$/;

export function normalizePhone(value: string): string | null {
  const compact = (value ?? '').replace(/[\s\-().]/g, '');
  for (const pattern of PHONE_PATTERNS) {
    const match = compact.match(pattern);
    if (match) return `+254${match[1]}`;
  }
  return null;
}

export const cleanText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

export class FieldErrors {
  errors: Record<string, string> = {};
  add(field: string, message: string) {
    this.errors[field] ??= message;
  }
  throwIfAny() {
    const first = Object.values(this.errors)[0];
    if (first) throw new ApiError(422, first, this.errors);
  }
}

export interface FarmerFields {
  first_name?: string;
  last_name?: string;
  phone?: string;
  national_id?: string | null;
  village?: string | null;
  centre_id?: string | null;
  farmer_number?: string;
  status?: string;
}

/** Returns the normalised fields (as the server stores them) or throws ApiError(422) with field messages. */
export function validateFarmer(input: FarmerFields, creating: boolean): FarmerFields {
  const errors = new FieldErrors();
  const out: FarmerFields = { ...input };
  for (const name of ['first_name', 'last_name'] as const) {
    if (name in input || creating) {
      const v = cleanText(input[name]);
      if (!v) errors.add(name, 'This field is required.');
      else if (v.length > 100) errors.add(name, 'Use at most 100 characters.');
      out[name] = v;
    }
  }
  if ('phone' in input || creating) {
    const phone = normalizePhone(input.phone ?? '');
    if (!phone) errors.add('phone', 'Enter a Kenyan mobile number, e.g. 0712 345 678 or +254 712 345 678.');
    else out.phone = phone;
  }
  if (input.national_id) {
    const id = input.national_id.replace(/\s/g, '');
    if (!/^\d{7,8}$/.test(id)) errors.add('national_id', 'National ID number must be 7 or 8 digits.');
    out.national_id = id;
  }
  if (input.village !== undefined) out.village = cleanText(input.village) || null;
  if (input.farmer_number) {
    const code = input.farmer_number.replace(/\s/g, '').toUpperCase();
    if (!CODE.test(code)) errors.add('farmer_number', "Use 2-50 letters, digits, '-', '_' or '/' (for example CTR-001).");
    out.farmer_number = code;
  }
  errors.throwIfAny();
  return out;
}

export interface CentreFields {
  name?: string;
  code?: string;
  has_cooler?: boolean;
  cooler_capacity_litres?: number | null;
  location_description?: string | null;
}

export function validateCentre(input: CentreFields, creating: boolean): CentreFields {
  const errors = new FieldErrors();
  const out = { ...input };
  if ('name' in input || creating) {
    const name = cleanText(input.name);
    if (name.length < 2) errors.add('name', 'Use at least 2 characters.');
    out.name = name;
  }
  if (input.code) {
    const code = input.code.replace(/\s/g, '').toUpperCase();
    if (!CODE.test(code)) errors.add('code', "Use 2-50 letters, digits, '-', '_' or '/' (for example CTR-001).");
    out.code = code;
  }
  const cap = input.cooler_capacity_litres;
  if (cap != null && (!(cap > 0) || cap > 1_000_000)) errors.add('cooler_capacity_litres', 'Enter a capacity above 0.');
  errors.throwIfAny();
  return out;
}

export interface CollectionFields {
  farmer_id?: string;
  quantity_litres?: number;
  fat_percentage?: number | null;
  snf_percentage?: number | null;
  temperature_c?: number | null;
  collection_date?: string;
  quality_status?: string;
  rejection_reason?: string | null;
}

export function validateCollection(input: CollectionFields): void {
  const errors = new FieldErrors();
  if (!input.farmer_id) errors.add('farmer_id', 'Choose a farmer.');
  const qty = input.quantity_litres;
  if (qty === undefined || !Number.isFinite(qty) || qty <= 0) errors.add('quantity_litres', 'Enter the quantity in litres (more than 0).');
  else if (qty > 10_000) errors.add('quantity_litres', 'That is more than 10,000 litres. Check the quantity.');
  for (const [field, max] of [['fat_percentage', 20], ['snf_percentage', 20]] as const) {
    const v = input[field];
    if (v != null && (!Number.isFinite(v) || v < 0 || v > max)) errors.add(field, `Enter a value between 0 and ${max}.`);
  }
  const t = input.temperature_c;
  if (t != null && (!Number.isFinite(t) || t < -5 || t > 60)) errors.add('temperature_c', 'Enter a temperature between -5 and 60 °C.');
  if (input.collection_date) {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (input.collection_date > tomorrow) errors.add('collection_date', "A collection can't be dated in the future.");
  }
  if (input.quality_status === 'REJECTED' && cleanText(input.rejection_reason).length < 3) {
    errors.add('rejection_reason', 'Say why this milk was rejected.');
  }
  errors.throwIfAny();
}

export interface ReadingFields {
  volume_litres?: number | null;
  temperature_celsius?: number | null;
  battery_percent?: number | null;
  measured_at: string;
}

/**
 * Hard errors throw (the server would refuse them too). Implausible-but-possible values are returned as
 * flags: the reading is still saved and the server marks it suspicious.
 */
export function validateReading(input: ReadingFields, capacityLitres: number | null): string[] {
  const errors = new FieldErrors();
  const flags: string[] = [];
  const v = input.volume_litres;
  if (v != null) {
    if (!Number.isFinite(v)) errors.add('volume_litres', 'The volume must be a number.');
    else if (v < 0) errors.add('volume_litres', "The volume can't be negative.");
    else if (capacityLitres && v > capacityLitres * 1.05) flags.push('above_capacity');
  }
  const t = input.temperature_celsius;
  if (t != null && (!Number.isFinite(t) || t < -30 || t > 80)) errors.add('temperature_celsius', 'Temperature out of range.');
  else if (t != null && (t < -5 || t > 40)) flags.push('implausible_temperature');
  const b = input.battery_percent;
  if (b != null && (!Number.isInteger(b) || b < 0 || b > 100)) errors.add('battery_percent', 'Battery must be 0-100%.');
  const at = Date.parse(input.measured_at);
  if (Number.isNaN(at)) errors.add('measured_at', 'Invalid measurement time.');
  else if (at > Date.now() + 5 * 60_000) flags.push('future_timestamp');
  if (v == null && t == null && b == null) errors.add('volume_litres', 'The reading has no measurement.');
  errors.throwIfAny();
  return flags;
}
