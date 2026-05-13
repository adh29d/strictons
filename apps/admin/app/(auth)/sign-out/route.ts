import { NextResponse, type NextRequest } from 'next/server';
import { wrapRouteHandlerWithSentry } from '@sentry/nextjs';
import { createServerClient } from '@strictons/db/server';
import { writeAuditLog } from '@strictons/db/audit';

/**
 * POST /sign-out (admin app)
 *
 * Duplicated from the partners-side handler per §4 of the approved
 * plan (app-specific UI plumbing; the body is trivially small and
 * the per-app Route Handler shape doesn't share usefully). The only
 * material difference is the Sentry wrapper invocation's
 * parameterizedRoute, which informs Sentry's transaction naming.
 *
 * POST-only on purpose: GET would let an attacker sign a user out
 * by sneaking the URL into an <img src> tag on a third-party page.
 * With POST + same-site lax cookie behaviour the request fails CSRF
 * implicitly. Forms posting to this URL must be same-origin.
 *
 * Wrapped in wrapRouteHandlerWithSentry — the SDK-native equivalent
 * of withServerActionInstrumentation for Route Handlers (auto-flush
 * via vercelWaitUntil + original-error-preserving captureException
 * for unhandled throws). Same locked pattern as commit 2's Server
 * Action wrap.
 *
 * Calls supabase.auth.signOut() on the SSR client (clears the session
 * cookies), audit-logs the sign-out, redirects to /sign-in via 303 so
 * the browser switches to GET.
 */
export const POST = wrapRouteHandlerWithSentry(
  async (request: NextRequest): Promise<NextResponse> => {
    const supabase = await createServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.auth.signOut();

    if (user) {
      await writeAuditLog({
        actor_user_id: user.id,
        actor_role: 'system',
        action: 'sign_out',
        entity_type: 'auth_attempt',
        entity_id: crypto.randomUUID(),
        after: { user_id: user.id, email: user.email ?? null },
      });
    }

    const url = new URL(request.url);
    return NextResponse.redirect(new URL('/sign-in', url.origin), 303);
  },
  { method: 'POST', parameterizedRoute: '/sign-out' },
);
