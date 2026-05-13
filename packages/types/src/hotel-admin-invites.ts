import { z } from 'zod';

/**
 * Zod schemas for the Phase 5 staff-initiated hotel-admin flows in
 * apps/admin/app/(protected)/hotels/[id]/actions.ts.
 *
 * Distinct from `./invites` (which carries the partners-app member
 * invite + revoke shapes from Phase 3). The hotel-admin variants are
 * staff-initiated and share the magic-link transport but differ in
 * semantics: Surface 1 creates a hotel_users row; Surface 2 resends
 * the portal access link against an existing row.
 *
 * Phase 5 Q3 finding (confirmed): no DB-level `invite_source` enum is
 * needed. The audit_log action string (hotel_admin_invite_issued vs
 * partners-side invite_issued) plus `actor_role` ('strictons_staff'
 * vs 'hotel_admin') carries the source for downstream reporting.
 */

/**
 * Input for Surface 1 — staff invites a hotel admin by email.
 *
 * `is_admin` is intentionally NOT part of this input — Phase 2's
 * `set_first_invitee_admin` BEFORE-INSERT trigger flips it true for
 * the very first member of a hotel; the calling Server Action sets
 * is_admin=true explicitly via service-role for subsequent rows
 * (idempotent with the trigger). Either way, this schema describes
 * the user-supplied fields, not the trigger-or-action-controlled ones.
 */
export const InviteHotelAdminInputSchema = z.object({
  email: z.email(),
  hotelId: z.uuid(),
});
export type InviteHotelAdminInput = z.infer<typeof InviteHotelAdminInputSchema>;

/**
 * Input for Surface 2 — staff resends the portal access link to an
 * existing hotel_users row.
 *
 * Both `hotelId` and `hotelUserId` are required: the calling action
 * cross-checks that hotel_users.hotel_id matches the submitted
 * hotelId, preventing a form on hotel B's page from submitting a
 * hotel_user id belonging to hotel A. Smuggling defence — the staff
 * user has permissions for every hotel via service-role, but the
 * cross-check ensures the UI's hotel-scoping is honoured server-side.
 */
export const ResendPortalAccessLinkInputSchema = z.object({
  hotelId: z.uuid(),
  hotelUserId: z.uuid(),
});
export type ResendPortalAccessLinkInput = z.infer<typeof ResendPortalAccessLinkInputSchema>;
