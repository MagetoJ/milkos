// Mirrors backend/core/validation.py. The backend is the authority; these give instant feedback.

export const KENYAN_COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo',
  'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale',
  'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa',
  "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya',
  'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga',
  'Wajir', 'West Pokot',
] as const;

export interface OnboardingForm {
  cooperative_name: string;
  registration_number: string;
  kra_pin: string;
  county: string;
  location: string;
  estimated_daily_liters: string;
  initial_coolers_count: string;
  admin_full_name: string;
  admin_id_number: string;
  admin_email: string;
  admin_phone: string;
  password: string;
  confirm_password: string;
  additional_info: string;
}

export type FieldErrors = Partial<Record<keyof OnboardingForm | 'form', string>>;

export function normalizePhone(value: string): string | null {
  let d = value.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (/^0[17]\d{8}$/.test(d)) d = '254' + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) d = '254' + d;
  return /^254[17]\d{8}$/.test(d) ? `+${d}` : null;
}

const text = (v: string) => v.trim().replace(/\s+/g, ' ');

/** Returns an error message, or undefined when the value is fine. */
export function validateField(name: keyof OnboardingForm, form: OnboardingForm): string | undefined {
  const v = form[name];
  switch (name) {
    case 'cooperative_name':
      return text(v).length < 3 ? 'Enter the cooperative’s official name (at least 3 characters).' : undefined;
    case 'registration_number':
      return text(v).length < 3 || !/^[A-Za-z0-9/\-. ]+$/.test(v.trim())
        ? 'Enter the registration number as it appears on the certificate, e.g. CS/12345.'
        : undefined;
    case 'kra_pin':
      return /^[AP]\d{9}[A-Z]$/i.test(v.replace(/\s/g, ''))
        ? undefined
        : 'KRA PIN is a letter A or P, 9 digits and a letter, e.g. P051234567Z.';
    case 'county':
      return (KENYAN_COUNTIES as readonly string[]).includes(v) ? undefined : 'Choose the county the cooperative operates in.';
    case 'location':
      return text(v).length < 2 ? 'Enter the town or sub-county.' : undefined;
    case 'estimated_daily_liters':
      return v && (isNaN(Number(v)) || Number(v) < 0) ? 'Enter litres as a number, e.g. 4500.' : undefined;
    case 'initial_coolers_count':
      return v && (!/^\d+$/.test(v) || Number(v) > 500) ? 'Enter a whole number of coolers.' : undefined;
    case 'admin_full_name':
      return text(v).length < 3 ? 'Enter the administrator’s full name.' : undefined;
    case 'admin_id_number':
      return /^\d{7,8}$/.test(v.replace(/\s/g, '')) ? undefined : 'National ID number must be 7 or 8 digits.';
    case 'admin_email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? undefined : 'Enter a valid email address.';
    case 'admin_phone':
      return normalizePhone(v) ? undefined : 'Enter a Kenyan mobile number, e.g. 0712 345 678.';
    case 'password':
      if (v.length < 8) return 'Use at least 8 characters.';
      if (!/\d/.test(v)) return 'Include at least one number.';
      if (!/[A-Z]/.test(v)) return 'Include at least one capital letter.';
      return undefined;
    case 'confirm_password':
      if (!v) return 'Type the password again to confirm it.';
      return v !== form.password ? 'Passwords don’t match.' : undefined;
    default:
      return undefined;
  }
}

export function validateAll(form: OnboardingForm): FieldErrors {
  const errors: FieldErrors = {};
  (Object.keys(form) as (keyof OnboardingForm)[]).forEach((k) => {
    const e = validateField(k, form);
    if (e) errors[k] = e;
  });
  return errors;
}

/** Builds the API payload in the shape the backend expects. */
export function toPayload(form: OnboardingForm) {
  return {
    cooperative_name: text(form.cooperative_name),
    registration_number: text(form.registration_number),
    kra_pin: form.kra_pin.replace(/\s/g, '').toUpperCase(),
    county: form.county,
    location: text(form.location),
    estimated_daily_liters: form.estimated_daily_liters ? Number(form.estimated_daily_liters) : null,
    initial_coolers_count: form.initial_coolers_count ? Number(form.initial_coolers_count) : null,
    admin_full_name: text(form.admin_full_name),
    admin_id_number: form.admin_id_number.replace(/\s/g, ''),
    admin_email: form.admin_email.trim().toLowerCase(),
    admin_phone: normalizePhone(form.admin_phone) ?? form.admin_phone,
    password: form.password,
    confirm_password: form.confirm_password,
    additional_info: form.additional_info.trim() || null,
  };
}

/** Maps FastAPI 422 / our 409 `detail` arrays onto form fields. */
export function errorsFromApi(detail: unknown): FieldErrors {
  if (typeof detail === 'string') return { form: detail };
  if (!Array.isArray(detail)) return { form: 'Something went wrong. Please try again.' };
  const errors: FieldErrors = {};
  for (const d of detail as { loc?: unknown[]; msg?: string }[]) {
    const field = String(d.loc?.[d.loc.length - 1] ?? 'form') as keyof FieldErrors;
    errors[field in blankForm() || field === 'form' ? field : 'form'] = d.msg ?? 'Invalid value.';
  }
  return errors;
}

export function blankForm(): OnboardingForm {
  return {
    cooperative_name: '', registration_number: '', kra_pin: '', county: '', location: '',
    estimated_daily_liters: '', initial_coolers_count: '',
    admin_full_name: '', admin_id_number: '', admin_email: '', admin_phone: '',
    password: '', confirm_password: '', additional_info: '',
  };
}
