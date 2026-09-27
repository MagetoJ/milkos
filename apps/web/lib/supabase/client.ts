import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseKey, supabaseUrl } from './config';

let client: SupabaseClient | undefined;

/** One browser client per tab; the session lives in cookies so the proxy can read it too. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) for the web app.');
    }
    client = createBrowserClient(supabaseUrl, supabaseKey);
  }
  return client;
}
