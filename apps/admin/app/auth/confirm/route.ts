import { NextResponse, type NextRequest } from 'next/server';
import { wrapRouteHandlerWithSentry } from '@sentry/nextjs';
import { createServerClient } from '@strictons/db/server';
import { writeAuditLog } from '@strictons/db/audit';
import { isSafeNextPath } from '@strictons/db/auth-helpers';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside the function body, never at module top-level.
 * (This handler doesn't read env directly; the SSR client it constructs
 * does, and it follows the convention.)
 */

/**
 * GET /auth/confirm?token_hash=…&type=email&next=/
 *
 * Magic-link callback for the admin app. The link in the SendGrid email
 * points here (built with appUrl = resolveAppUrl('admin') in the
 * sign-in Server Action). Flow:
 *
 *   1. Validate query shape. Bad shape → /sign-in?error=invalid
 *   2. SSR client calls supabase.auth.verifyOtp({type, token_hash}).
 *      Failure (invalid/expired) → audit-log sign_in_failed →
 *      /sign-in?error=expired
 *   3. Audit-log sign_in_succeeded, redirect to a SAFE next path.
 *
 * Compared to the partners-side handler this DOES NOT reconcile
 * invites. The admin app has no invite flow this phase — staff users
 * are provisioned via the service-role runbook in packages/db/README.md
 * (lands in commit 7), not via the membership-INSERT path that
 * hotel_users / business_users use in partners. Phase 5+ may add a
 * staff-invite mechanism; this handler will gain the reconcile step
 * symmetrically when that arrives.
 *
 * Audit-log placement: BEFORE the redirect, like the partners-side
 * handler. The redirect is the user-visible signal that auth
 * succeeded; the audit row is the durable record that survives even
 * if the redirect response is dropped client-side. Putting the
 * write after the redirect (via `unstable_after`) would change the
 * failure semantics — silent audit gap on dropped responses, no
 * audit if the function freezes between redirect and write —
 * neither of which we want for the auth path.
 *
 * Wrapped in wrapRouteHandlerWithSentry — the SDK-native equivalent
 * of withServerActionInstrumentation for Route Handlers (auto-flush
 * via vercelWaitUntil + original-error-preserving captureException
 * for unhandled throws). Same locked pattern as commit 2's Server
 * Action wrap. Magic-link verification is the highest-stakes error
 * path in the entire auth flow — full server-side error capture is
 * non-negotiable here.
 */
export const GET = wrapRouteHandlerWithSentry(
  async (request: NextRequest): Promise<NextResponse> => {
    const url = new URL(request.url);
    const tokenHash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    const rawNext = url.searchParams.get('next');
    const next = isSafeNextPath(rawNext) ? rawNext! : '/';

    if (!tokenHash || type !== 'email') {
      return NextResponse.redirect(new URL('/sign-in?error=invalid', url.origin));
    }

    const supabase = await createServerClient();

    const { data, error } = await supabase.auth.verifyOtp({
      type: 'email',
      token_hash: tokenHash,
    });

    if (error || !data.user) {
      await writeAuditLog({
        actor_user_id: null,
        actor_role: 'anonymous',
        action: 'sign_in_failed',
        entity_type: 'auth_attempt',
        entity_id: crypto.randomUUID(),
        after: {
          reason: error?.code ?? 'verify_otp_no_user',
          message: error?.message ?? null,
        },
      });
      return NextResponse.redirect(new URL('/sign-in?error=expired', url.origin));
    }

    const userId = data.user.id;
    const email = data.user.email ?? null;

    await writeAuditLog({
      actor_user_id: userId,
      actor_role: 'system',
      action: 'sign_in_succeeded',
      entity_type: 'auth_attempt',
      entity_id: crypto.randomUUID(),
      after: { user_id: userId, email },
    });

    return NextResponse.redirect(new URL(next, url.origin));
  },
  { method: 'GET', parameterizedRoute: '/auth/confirm' },
);
