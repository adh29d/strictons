import { NextResponse, type NextRequest } from 'next/server';
import type { MembershipSet } from '@strictons/db/auth-types';
import { createMiddlewareClient } from '@strictons/db/middleware';
import { getMembershipSet } from '@strictons/db/roles';
import { decideAuth } from '@/lib/middleware-decision';

/**
 * Partners-app middleware. Runs on every request matched by `config.matcher`
 * below; gates protected routes on (a) verified Supabase auth and (b)
 * presence of at least one hotel_users / business_users / strictons_staff
 * membership.
 *
 * Cookie writes — including the @supabase/ssr 0.10.0 cache-control
 * headers that prevent CDNs from caching authenticated responses —
 * are handled by createMiddlewareClient (in @strictons/db/middleware).
 * The closure-bound NextResponse mutates in place during a token
 * refresh; we read it via getResponse() AFTER the auth-check await.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const { supabase, getResponse } = createMiddlewareClient(request);

  // Use getUser() rather than getSession(): getUser() validates the JWT
  // against GoTrue on every call (security); getSession() trusts the
  // cookie unverified (cheaper but lets a forged cookie through).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let memberships: MembershipSet | null = null;
  if (user) {
    try {
      memberships = await getMembershipSet(supabase, user.id);
    } catch (cause) {
      // [diagnostic-c10] The original log only carried .message which
      // misses important fields when the throw is a PostgrestError
      // (object-shaped, not Error-subclass) or when it's the
      // "user not found in public.users" Error from roles.ts. Verbose
      // shape lets us tell which throw path fired and what Supabase
      // actually returned. Remove once the regression is diagnosed.
      const causeShape =
        cause === null || cause === undefined
          ? null
          : typeof cause === 'object'
            ? Object.getOwnPropertyNames(cause).reduce<Record<string, unknown>>((acc, k) => {
                acc[k] = (cause as Record<string, unknown>)[k];
                return acc;
              }, {})
            : { value: String(cause) };
      console.error('[middleware] getMembershipSet failed; failing closed', {
        userId: user.id,
        userEmail: user.email ?? null,
        path: url.pathname,
        causeIsError: cause instanceof Error,
        causeName: cause instanceof Error ? cause.name : null,
        causeMessage: cause instanceof Error ? cause.message : null,
        causeStack: cause instanceof Error ? cause.stack : null,
        causeShape,
      });
      // Fail closed: if we can't determine memberships, treat as
      // no-access rather than letting the user through unscoped.
      memberships = {
        userId: user.id,
        email: user.email ?? '',
        roles: [],
        isStrictonsStaff: false,
      };
    }
  }

  const decision = decideAuth({
    hasUser: Boolean(user),
    memberships,
    pathname: url.pathname,
    search: url.search,
  });

  if (decision.kind === 'redirect') {
    const target = url.clone();
    const [path, query] = decision.to.split('?');
    target.pathname = path ?? '/sign-in';
    target.search = query ? `?${query}` : '';
    return NextResponse.redirect(target);
  }

  return getResponse();
}

/**
 * Matcher: every path except the ones explicitly listed in the negative
 * lookahead. Unprotected paths:
 *
 *   _next/static, _next/image — Next.js build assets
 *   favicon.ico               — root favicon request
 *   sign-in, sign-in/*        — sign-in form + check-inbox + future variants
 *   auth/confirm              — session-establishment Route Handler;
 *                                cannot be gated behind auth or it can't
 *                                run at all
 *   no-access                 — the wedged-user landing page; the page
 *                                itself authenticates via createServerClient
 *                                and renders a sign-out CTA, so it doesn't
 *                                need middleware to gate it
 *   api/_test                 — gated test-only Route Handlers (commit 13);
 *                                E2E_MODE controls availability there
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sign-in|auth/confirm|no-access|api/_test).*)',
  ],
};
