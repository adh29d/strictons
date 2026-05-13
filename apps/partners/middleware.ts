import { NextResponse, type NextRequest } from 'next/server';
import type { MembershipSet } from '@strictons/db/auth-types';
import { createMiddlewareClient } from '@strictons/db/middleware';
import { getMembershipSet } from '@strictons/db/roles';
import { decideAuth } from '@strictons/db/auth-helpers';

/**
 * Partners-side allow predicate for the lifted decideAuth.
 *
 *   m.roles is hotel_admin / hotel_user / business_admin / business_user
 *   m.isStrictonsStaff is the Phase 4 slot — wired in commit 5; if a
 *   staff user is also a hotel/business member, .roles already grants
 *   passage. Including isStrictonsStaff here means a staff-only user
 *   (no hotel/business membership) can also sign in to the partners
 *   app without hitting /no-access.
 */
const partnersAllowWhen = (m: MembershipSet): boolean => m.roles.length > 0 || m.isStrictonsStaff;

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
      console.error('[middleware] getMembershipSet failed; failing closed', {
        userId: user.id,
        cause: cause instanceof Error ? cause.message : String(cause),
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
    allowWhen: partnersAllowWhen,
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
 *   sign-out                  — POST-only Route Handler that clears the
 *                                Supabase session. Must NOT be gated by
 *                                middleware: a wedged user (no memberships)
 *                                otherwise gets redirected to /no-access
 *                                instead of signing out, with the redirect
 *                                preserving POST and silently no-op'ing.
 *   auth/confirm              — session-establishment Route Handler;
 *                                cannot be gated behind auth or it can't
 *                                run at all
 *   no-access                 — the wedged-user landing page; the page
 *                                itself authenticates via createServerClient
 *                                and renders a sign-out CTA, so it doesn't
 *                                need middleware to gate it
 *   api/test                  — gated test-only Route Handlers (commit 14);
 *                                E2E_MODE controls availability there
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sign-in|sign-out|auth/confirm|no-access|api/test).*)',
  ],
};
