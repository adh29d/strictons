import { createServiceRoleClient } from '@strictons/db/client';
import { buildConfirmUrl, resolveAppUrl } from '@strictons/db/auth-helpers';
import {
  sendHotelAdminInvite,
  sendHotelAdminResend,
  type SendHotelAdminInviteResult,
  type SendHotelAdminResendResult,
} from '@strictons/email/send';
import { MAGIC_LINK_EXPIRY_MINUTES } from '@strictons/email/constants';

/**
 * Admin-app-private helper for the Phase 5 staff-initiated hotel-admin
 * magic-link transport. Server-only — must NEVER be imported from any
 * 'use client' module. The createServiceRoleClient() call inside
 * inlines SUPABASE_SECRET_KEY into the browser bundle if reachable
 * from client code (the multi-line warning on createServiceRoleClient
 * itself spells this out).
 *
 * Not a Server Action — no 'use server' directive. This is an internal
 * module called BY the Server Actions in the sibling actions.ts
 * (commit 4). Sync helpers, types, and constants are allowed at the
 * top of the file.
 *
 * Two callers — both Server Actions on this same hotel edit page:
 *
 *   - inviteHotelAdmin            → kind: 'invite' (Surface 1, first-touch)
 *   - resendPortalAccessLink      → kind: 'resend' (Surface 2, routine)
 *
 * Lift to @strictons/db/auth-helpers if a third caller emerges; until
 * then the helper stays admin-private under _lib/ (underscore-prefix
 * folder excluded from Next.js routing per the Phase 3 gotcha).
 *
 * URL construction mirrors the partners-side sign-in action's exact
 * shape — redirectTo = `${partnersUrl}/auth/confirm?next=${encoded}`
 * and link = buildConfirmUrl({ appUrl: partnersUrl, tokenHash, type:
 * 'email', next }). The partners-side /auth/confirm reconciliation
 * (Phase 3) works without changes because staff-initiated invites
 * match the partners-side shape; deviating here would silently break
 * reconciliation. Phase 5 Q2 finding confirmed.
 *
 * Env-var read convention: process.env access happens inside the
 * function body, never at module top level. NEXT_PUBLIC_PARTNERS_URL
 * presence is checked explicitly BEFORE calling resolveAppUrl —
 * resolveAppUrl falls back to VERCEL_URL when the explicit var is
 * unset, which is the right behaviour for in-app calls but wrong for
 * cross-app (the admin-app's VERCEL_URL points at admin, not
 * partners). The explicit check turns a silent footgun into a loud
 * failure naming the missing env var.
 */

export type SendHotelAdminMagicLinkInput = {
  hotelId: string;
  hotelName: string;
  email: string;
  kind: 'invite' | 'resend';
};

export type SendHotelAdminMagicLinkResult = {
  link: string;
  transportResult: SendHotelAdminInviteResult | SendHotelAdminResendResult;
};

export async function sendHotelAdminMagicLink(
  input: SendHotelAdminMagicLinkInput,
): Promise<SendHotelAdminMagicLinkResult> {
  // Explicit env-var presence check. resolveAppUrl('partners') would
  // otherwise fall back to VERCEL_URL — which on the admin app points
  // at the admin deployment, not partners. Silent mis-targeting is
  // the failure mode we want to make loud.
  if (!process.env.NEXT_PUBLIC_PARTNERS_URL) {
    throw new Error(
      'sendHotelAdminMagicLink: NEXT_PUBLIC_PARTNERS_URL must be set in the admin Vercel ' +
        'project. The admin app cannot rely on VERCEL_URL as a fallback for cross-app URL ' +
        'construction — that would point at the admin deployment, not partners. Set the env ' +
        'var in Settings → Environment Variables for all relevant environments.',
    );
  }

  const partnersUrl = resolveAppUrl('partners');
  const next = '/';
  const redirectTo = `${partnersUrl}/auth/confirm?next=${encodeURIComponent(next)}`;

  // Generate the magic-link token via service-role. The response's
  // properties.hashed_token is what verifyOtp({type: 'email',
  // token_hash}) consumes on the partners /auth/confirm side (C1
  // verification in Phase 3 commit 8 locked this shape in).
  const supabase = createServiceRoleClient();
  const { data, error: generateError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: input.email,
    options: { redirectTo },
  });

  if (generateError) {
    // Bubble unchanged. The calling Server Action wraps this in a
    // try/catch and audit-logs with reason: 'generate_link_failed'.
    throw generateError;
  }

  const tokenHash = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
  if (!tokenHash) {
    throw new Error(
      'sendHotelAdminMagicLink: admin.generateLink response missing properties.hashed_token; ' +
        'Supabase response shape changed unexpectedly',
    );
  }

  const link = buildConfirmUrl({
    appUrl: partnersUrl,
    tokenHash,
    type: 'email',
    next,
  });

  // Dispatch to the right template wrapper. Both wrappers default
  // expiresInMinutes to MAGIC_LINK_EXPIRY_MINUTES; we pass it
  // explicitly so the body copy matches the actual Supabase TTL.
  const transportResult =
    input.kind === 'invite'
      ? await sendHotelAdminInvite({
          to: input.email,
          link,
          hotelName: input.hotelName,
          expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES,
        })
      : await sendHotelAdminResend({
          to: input.email,
          link,
          hotelName: input.hotelName,
          expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES,
        });

  return { link, transportResult };
}
