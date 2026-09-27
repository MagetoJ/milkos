import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { safeNext } from './lib/redirect';
import { supabaseKey, supabaseUrl } from './lib/supabase/config';

/** Pages that work without a session. Mirrors isPublicPath in AuthProvider. */
const PUBLIC_PATHS = ['/', '/login', '/forgot-password', '/reset-password', '/applications/status'];

/**
 * Keeps the Supabase session cookies fresh and sends signed-out visitors to
 * /login. This is a convenience for the UI only: the API verifies the access
 * token and the caller's permissions on every request.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Verifies the token signature (and refreshes it when needed) rather than trusting the cookie.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.includes(path) || path.startsWith('/auth/');

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }
  if (data?.claims && path === '/login') {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get('next')), request.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
