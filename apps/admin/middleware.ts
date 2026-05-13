import { NextResponse, type NextRequest } from 'next/server';
import type { MembershipSet } from '@strictons/db/auth-types';
import { createMiddlewareClient } from '@strictons/db/middleware';
import { getMembershipSet } from '@strictons/db/roles';
import { decideAuth } from '@strictons/db/auth-helpers';

/**
 * Admin-side allow predicate for the shared decideAuth.
 *
 *   Strictons staff only. Hotel / business memberships do not grant
 *   access to the admin app, even if the user holds them — those
 *   belong to the partners app. This is the audience split the
 *   admin/partners app separation was designed for.
 *
 * Commit 5 wired isStrictonsStaff to a real query against
 * public.strictons_staff (RLS-enforced read, SECURITY DEFINER helper),
 * so this predicate now evaluates meaningfully — Phase 3's hardcoded
 * false would have routed every signed-in user to /no-access here.
 */
const adminAllowWhen = (m: MembershipSet): boolean => m.isStrictonsStaff;

/**
 * Admin-app middleware. Runs on every request matched by `config.matcher`
 * below; gates protected routes on (a) verified Supabase auth and (b)
 * presence in public.strictons_staff.
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
    allowWhen: adminAllowWhen,
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
 * lookahead. Per Phase 3 gotcha #6 ("middleware matcher must explicitly
 * exclude /sign-out"), the exclusion list is enumerated, not implicit —
 * a middleware-induced 307 on a POST to /sign-out would silently re-POST
 * to /no-access and the sign-out Route Handler would never run.
 *
 * Unprotected paths (mirror of the partners-side list):
 *
 *   _next/static, _next/image — Next.js build assets
 *   favicon.ico               — root favicon request
 *   sign-in, sign-in/*        — sign-in form + check-inbox + future variants
 *   sign-out                  — POST-only Route Handler that clears the
 *                                Supabase session. Must NOT be gated by
 *                                middleware (see above).
 *   auth/confirm              — session-establishment Route Handler;
 *                                cannot be gated behind auth or it can't
 *                                run at all.
 *   no-access                 — the wedged-user landing page; the page
 *                                itself authenticates via createServerClient
 *                                and renders a sign-out CTA, so it doesn't
 *                                need middleware to gate it.
 *   api/test                  — test-only Route Handlers (E2E_MODE gated;
 *                                admin app has no such handlers in commit
 *                                6 but exclusion is included for parity
 *                                with partners and so commit 8's E2E can
 *                                add them without a matcher edit).
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sign-in|sign-out|auth/confirm|no-access|api/test).*)',
  ],
};
