// NEXT_PUBLIC_* values are inlined at build time, so each must be referenced literally.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  /** New projects: publishable key (sb_publishable_...). Older projects: the anon key. */
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/+$/, ''),
  /** Phone OTP needs a Supabase SMS hook wired to Africa's Talking; off until then. */
  phoneAuthEnabled: process.env.NEXT_PUBLIC_AUTH_PHONE_ENABLED === 'true',
};
