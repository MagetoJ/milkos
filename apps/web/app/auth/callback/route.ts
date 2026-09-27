import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '../../../lib/supabase/server';
import { safeNext } from '../../../lib/redirect';

/** OAuth and PKCE email links (sign-up confirmation, password recovery) land here with ?code=. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  const failure = searchParams.get('error_description');

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('error', failure || 'That sign-in link is invalid or has expired. Try again.');
  return NextResponse.redirect(login);
}
