import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/** Browser Supabase client. Session lives in cookies so proxy.ts and server components see it too. */
export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseKey);
}
