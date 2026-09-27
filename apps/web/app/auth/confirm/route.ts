import type { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '../../../lib/supabase/server';
import { safeNext } from '../../../lib/redirect';

/**
 * Email links that carry a token hash (see docs/AUTH.md for the templates).
 * Invitations sent by the API are always this kind, because they are not
 * started from this browser and so cannot use a PKCE code.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  if (tokenHash && type) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // Invited and recovering users must choose a password before continuing.
      const destination = type === 'invite' ? '/reset-password?invited=1'
        : type === 'recovery' ? '/reset-password'
          : safeNext(searchParams.get('next'));
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('error', 'That email link is invalid or has expired. Ask for a new one.');
  return NextResponse.redirect(login);
}
