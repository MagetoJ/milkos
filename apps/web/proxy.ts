import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isPublicPath, safeNext } from '@/lib/auth/redirect';

/**
 * Keeps the Supabase session cookie fresh and performs the optimistic
 * "signed in?" redirect. Authorization (roles, tenants, MFA) is enforced by
 * the API on every request; this is only a UX gate.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() verifies the JWT signature; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  const redirect = (to: string) => {
    const target = NextResponse.redirect(new URL(to, request.url));
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };

  if (!signedIn && !isPublicPath(pathname)) {
    return redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  if (signedIn && (pathname === '/login' || pathname === '/signup')) {
    return redirect(safeNext(request.nextUrl.searchParams.get('next')));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
