import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@strictons/db/server';
import { createServiceRoleClient } from '@strictons/db/client';
import { writeAuditLog } from '@strictons/db/audit';
import { isSafeNextPath } from '@strictons/db/auth-helpers';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside the function body, never at module top-level.
 * (This handler doesn't read env directly; the SSR + service-role
 * clients it constructs do, and they follow the convention.)
 */

/**
 * GET /auth/confirm?token_hash=…&type=email&next=/
 *
 * Magic-link callback. The link in the SendGrid email points here. Flow:
 *
 *   1. Validate query shape. Bad shape → /sign-in?error=invalid
 *   2. SSR client calls supabase.auth.verifyOtp({type, token_hash}).
 *      Failure (invalid/expired) → audit-log sign_in_failed →
 *      /sign-in?error=expired
 *   3. On success, reconcile pending invites for this user's email via
 *      the service-role client (RLS would block lifting a hotel_users /
 *      business_users row out of user_id IS NULL — only service-role
 *      can do that). Audit-log invite_accepted per reconciled row.
 *   4. Audit-log sign_in_succeeded, redirect to a SAFE next path.
 *
 * The C1 verification round (commit 8 first push) confirms the
 * (token_hash type, verifyOtp type) pairing. Plan currently codes
 * against type='email'. If the empirical verification reveals a
 * different value, fix-forward in a small follow-up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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

  // Reconcile pending invites. Service-role bypasses RLS so the
  // user_id IS NULL → user_id = <auth.uid()> lift succeeds.
  if (email) {
    const service = createServiceRoleClient();
    const acceptedAt = new Date().toISOString();

    const [hotelReconcile, businessReconcile] = await Promise.all([
      service
        .from('hotel_users')
        .update({ user_id: userId, accepted_at: acceptedAt })
        .eq('invited_email', email)
        .is('user_id', null)
        .is('revoked_at', null)
        .select('id, hotel_id'),
      service
        .from('business_users')
        .update({ user_id: userId, accepted_at: acceptedAt })
        .eq('invited_email', email)
        .is('user_id', null)
        .is('revoked_at', null)
        .select('id, business_id'),
    ]);

    for (const row of hotelReconcile.data ?? []) {
      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'hotel_user',
        action: 'invite_accepted',
        entity_type: 'hotel_users',
        entity_id: row.id,
        entity_hotel_id: row.hotel_id,
        after: { email },
      });
    }
    for (const row of businessReconcile.data ?? []) {
      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'business_user',
        action: 'invite_accepted',
        entity_type: 'business_users',
        entity_id: row.id,
        entity_business_id: row.business_id,
        after: { email },
      });
    }
  }

  await writeAuditLog({
    actor_user_id: userId,
    actor_role: 'system',
    action: 'sign_in_succeeded',
    entity_type: 'auth_attempt',
    entity_id: crypto.randomUUID(),
    after: { user_id: userId, email },
  });

  return NextResponse.redirect(new URL(next, url.origin));
}
