import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseKey, supabaseUrl } from './config';

/** For route handlers: reads and writes the session cookies of the current request. */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
