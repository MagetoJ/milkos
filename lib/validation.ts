// Client-side mirror of backend/core/validation.py. The backend stays authoritative;
// these give instant feedback with the same rules and wording.

export const KENYA_COUNTIES = [
  'Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita-Taveta', 'Garissa', 'Wajir',
  'Mandera', 'Marsabit', 'Isiolo', 'Meru', 'Tharaka-Nithi', 'Embu', 'Kitui', 'Machakos',
  'Makueni', 'Nyandarua', 'Nyeri', 'Kirinyaga', "Murang'a", 'Kiambu', 'Turkana', 'West Pokot',
  'Samburu', 'Trans-Nzoia', 'Uasin Gishu', 'Elgeyo-Marakwet', 'Nandi', 'Baringo', 'Laikipia',
  'Nakuru', 'Narok', 'Kajiado', 'Kericho', 'Bomet', 'Kakamega', 'Vihiga', 'Bungoma', 'Busia',
  'Siaya', 'Kisumu', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi',
] as const;

const PHONE_PATTERNS = [/^\+254([17]\d{8})$/, /^254([17]\d{8})$/, /^0([17]\d{8})$/, /^([17]\d{8})$/];

/** Kenyan mobile number in E.164 (+2547XXXXXXXX / +2541XXXXXXXX), or null if it isn't one. */
export function normalizePhone(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, '');
  for (const pattern of PHONE_PATTERNS) {
    const match = compact.match(pattern);
    if (match) return `+254${match[1]}`;
  }
  return null;
}

export const MESSAGES = {
  phone: 'Enter a Kenyan mobile number, e.g. 0712 345 678 or +254 712 345 678.',
  kraPin: 'KRA PIN must be A or P, then 9 digits, then a letter (e.g. P051234567Z).',
  nationalId: 'National ID number must be 7 or 8 digits.',
  county: "Choose one of Kenya's 47 counties.",
  registrationNumber: "Registration number must be 3-50 characters: letters, digits, '/', '-' or '.' (e.g. CS/12345).",
  email: 'Enter a valid email address.',
} as const;

export const isKraPin = (v: string) => /^[AP]\d{9}[A-Z]$/i.test(v.replace(/\s/g, ''));
export const isNationalId = (v: string) => /^\d{7,8}$/.test(v.replace(/\s/g, ''));
export const isRegistrationNumber = (v: string) => /^[A-Z0-9][A-Z0-9/.\-]{2,49}$/i.test(v.replace(/\s/g, ''));
export const isCounty = (v: string) => (KENYA_COUNTIES as readonly string[]).includes(v);
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export function passwordProblem(v: string): string | null {
  if (v.length < 8) return 'Password must be at least 8 characters.';
  if (v.length > 64) return 'Password must be at most 64 characters.';
  if (!/\d/.test(v)) return 'Password must contain at least one digit.';
  if (!/[A-Z]/.test(v)) return 'Password must contain at least one uppercase letter.';
  return null;
}
