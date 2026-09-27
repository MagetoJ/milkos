import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/redirect';

/** PKCE code exchange for Google OAuth, email confirmation and password-recovery links. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  const reason = searchParams.get('error_description') ? 'provider' : 'link';
  return NextResponse.redirect(`${origin}/login?error=${reason}&next=${encodeURIComponent(next)}`);
}
