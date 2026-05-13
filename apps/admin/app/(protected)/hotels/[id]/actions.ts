'use server';

import { revalidatePath } from 'next/cache';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServiceRoleClient } from '@strictons/db/client';
import { writeAuditLog } from '@strictons/db/audit';
import { EmailSendError } from '@strictons/email/send';
import {
  InviteHotelAdminInputSchema,
  ResendPortalAccessLinkInputSchema,
} from '@strictons/types/hotel-admin-invites';
import { requireStaff } from '@/lib/require-staff';
import { sendHotelAdminMagicLink } from './_lib/hotel-admin-magic-link';
import type { InviteHotelAdminState, ResendPortalAccessLinkState } from './types';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside createServiceRoleClient() / resolveAppUrl(),
 * never at this module's top level. The hotel-admin-magic-link helper
 * (commit 3) enforces NEXT_PUBLIC_PARTNERS_URL presence loudly before
 * resolveAppUrl falls back to admin's VERCEL_URL.
 *
 * 'use server' rule: every export must be an async function. Constants,
 * zod schemas, and type aliases live in ./types.ts (state shapes) and
 * @strictons/types/hotel-admin-invites (input schemas). The runtime
 * check fires on first import per request, so the failure surfaces as
 * a 500 at the first form submission rather than at build time.
 *
 * Sentry instrumentation: every action wraps its body in
 * withServerActionInstrumentation per Phase 4 commit 2's locked
 * pattern. `formData` is NOT passed to the wrapper — form fields
 * include invitee email (PII) and we don't want it as a Sentry event
 * extra.
 *
 * Revalidation: every successful mutation calls
 * revalidatePath('/hotels/[id]') — the LITERAL route, not an
 * interpolated path. Next.js keys the revalidate on the route, not
 * the resolved URL, so the literal `/hotels/[id]` invalidates every
 * hotel-edit-page render.
 *
 * Writes via service-role client per Phase 2's locked decision. No
 * `FOR ALL to authenticated using is_strictons_staff()` policy exists
 * on `hotel_users`, so Strictons-side INSERTs bypass RLS via service-
 * role. The requireStaff check is defence-in-depth.
 *
 * Audit-log: every action writes either a success or a failure event
 * via writeAuditLog from @strictons/db/audit. audit_log is append-only
 * by trigger; rows outlive the hotel_users row if it is ever (soft-)
 * deleted, which is correct.
 */

// ----------------------------------------------------------------------------
// inviteHotelAdmin — Surface 1 (staff invites a hotel admin by email)
// ----------------------------------------------------------------------------

export async function inviteHotelAdmin(
  _prev: InviteHotelAdminState,
  formData: FormData,
): Promise<InviteHotelAdminState> {
  return withServerActionInstrumentation(
    'admin:inviteHotelAdmin',
    async (): Promise<InviteHotelAdminState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const rawEmail = (formData.get('email') ?? '').toString();
      const rawHotelId = (formData.get('hotelId') ?? '').toString();
      const parsed = InviteHotelAdminInputSchema.safeParse({
        email: rawEmail,
        hotelId: rawHotelId,
      });
      if (!parsed.success) {
        return { error: 'Please enter a valid email address.' };
      }
      const { email, hotelId } = parsed.data;

      // createServiceRoleClient() called inside the function body, not
      // at module scope (the Phase 3 module-instance-split gotcha).
      const service = createServiceRoleClient();

      // ---- SELECT the hotel for name + slug used in the email body ----
      const { data: hotelRow, error: hotelLookupError } = await service
        .from('hotels')
        .select('id, name, slug')
        .eq('id', hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'hotel_admin_invite_failed',
          entity_type: 'hotel_users',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: hotelId,
          after: {
            invited_email: email,
            reason: hotelLookupError ? 'hotel_lookup_failed' : 'hotel_not_found',
            message: hotelLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      // ---- INSERT hotel_users row with is_admin: true explicit ----
      // Idempotent with the migration 14 BEFORE-INSERT trigger that
      // auto-promotes the first row per hotel. Explicit set makes the
      // intent legible AND covers subsequent staff-side invites where
      // the trigger no-ops (count >= 1).
      const { data: inserted, error: insertError } = await service
        .from('hotel_users')
        .insert({
          hotel_id: hotelId,
          invited_email: email,
          invited_by: staffUserId,
          is_admin: true,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        // Postgres unique-violation on (hotel_id, invited_email):
        // surface as a per-field error rather than a generic 500.
        if (insertError?.code === '23505') {
          await writeAuditLog({
            actor_user_id: staffUserId,
            actor_role: 'strictons_staff',
            action: 'hotel_admin_invite_failed',
            entity_type: 'hotel_users',
            entity_id: crypto.randomUUID(),
            entity_hotel_id: hotelId,
            after: {
              invited_email: email,
              reason: 'already_invited',
              message: insertError.message,
            },
          });
          return {
            error: 'Please fix the errors below.',
            fieldErrors: {
              email:
                "This email is already on this hotel; use 'Resend portal access link' instead.",
            },
          };
        }

        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'hotel_admin_invite_failed',
          entity_type: 'hotel_users',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: hotelId,
          after: {
            invited_email: email,
            reason: 'insert_failed',
            message: insertError?.message ?? 'unknown',
          },
        });
        return { error: 'Could not create invitation. Please try again.' };
      }

      // ---- Send the magic link ----
      try {
        await sendHotelAdminMagicLink({
          hotelId,
          hotelName: hotelRow.name,
          email,
          kind: 'invite',
        });
      } catch (cause) {
        const reason = cause instanceof EmailSendError ? 'send_failed' : 'generate_link_failed';
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'hotel_admin_invite_failed',
          entity_type: 'hotel_users',
          entity_id: inserted.id,
          entity_hotel_id: hotelId,
          after: {
            invited_email: email,
            reason,
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
        return { error: 'Could not send invitation. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'hotel_admin_invite_issued',
        entity_type: 'hotel_users',
        entity_id: inserted.id,
        entity_hotel_id: hotelId,
        after: { invited_email: email },
      });

      revalidatePath('/hotels/[id]');
      return { ok: true, message: 'Invitation sent.' };
    },
  );
}

// ----------------------------------------------------------------------------
// resendPortalAccessLink — Surface 2 (staff resends portal access link
//   to an existing hotel admin)
// ----------------------------------------------------------------------------

export async function resendPortalAccessLink(
  _prev: ResendPortalAccessLinkState,
  formData: FormData,
): Promise<ResendPortalAccessLinkState> {
  return withServerActionInstrumentation(
    'admin:resendPortalAccessLink',
    async (): Promise<ResendPortalAccessLinkState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const parsed = ResendPortalAccessLinkInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
        hotelUserId: (formData.get('hotelUserId') ?? '').toString(),
      });
      if (!parsed.success) {
        return { error: 'Invalid resend request.' };
      }
      const { hotelId, hotelUserId } = parsed.data;

      const service = createServiceRoleClient();

      // ---- SELECT the hotel_users row ----
      const { data: memberRow, error: memberLookupError } = await service
        .from('hotel_users')
        .select('id, hotel_id, invited_email, revoked_at')
        .eq('id', hotelUserId)
        .maybeSingle();
      if (memberLookupError || !memberRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'portal_access_link_resend_failed',
          entity_type: 'hotel_users',
          entity_id: hotelUserId,
          entity_hotel_id: hotelId,
          after: {
            reason: memberLookupError ? 'lookup_failed' : 'not_found',
            message: memberLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel admin not found.' };
      }

      // ---- Cross-hotel id smuggling check ----
      // The staff user is authorised for every hotel via service-role,
      // but the form on hotel B's page must not be able to submit a
      // hotel_user id belonging to hotel A. Verify server-side.
      if (memberRow.hotel_id !== hotelId) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'portal_access_link_resend_failed',
          entity_type: 'hotel_users',
          entity_id: hotelUserId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'cross_hotel_smuggling',
            submitted_hotel_id: hotelId,
            actual_hotel_id: memberRow.hotel_id,
          },
        });
        return { error: 'Hotel admin not found.' };
      }

      // ---- Reject revoked rows before attempting send ----
      if (memberRow.revoked_at !== null) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'portal_access_link_resend_failed',
          entity_type: 'hotel_users',
          entity_id: hotelUserId,
          entity_hotel_id: hotelId,
          after: {
            invited_email: memberRow.invited_email,
            reason: 'revoked',
            revoked_at: memberRow.revoked_at,
          },
        });
        return { error: 'This admin has been revoked. Cannot resend access link.' };
      }

      // ---- SELECT the hotel row for name (used in the email body) ----
      const { data: hotelRow, error: hotelLookupError } = await service
        .from('hotels')
        .select('id, name')
        .eq('id', hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'portal_access_link_resend_failed',
          entity_type: 'hotel_users',
          entity_id: hotelUserId,
          entity_hotel_id: hotelId,
          after: {
            invited_email: memberRow.invited_email,
            reason: hotelLookupError ? 'hotel_lookup_failed' : 'hotel_not_found',
            message: hotelLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      // ---- Send the magic link ----
      try {
        await sendHotelAdminMagicLink({
          hotelId,
          hotelName: hotelRow.name,
          email: memberRow.invited_email,
          kind: 'resend',
        });
      } catch (cause) {
        const reason = cause instanceof EmailSendError ? 'send_failed' : 'generate_link_failed';
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'portal_access_link_resend_failed',
          entity_type: 'hotel_users',
          entity_id: hotelUserId,
          entity_hotel_id: hotelId,
          after: {
            invited_email: memberRow.invited_email,
            reason,
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
        return { error: 'Could not resend portal access link. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'portal_access_link_resent',
        entity_type: 'hotel_users',
        entity_id: hotelUserId,
        entity_hotel_id: hotelId,
        after: { invited_email: memberRow.invited_email },
      });

      revalidatePath('/hotels/[id]');
      return { ok: true, message: 'Portal access link resent.' };
    },
  );
}
