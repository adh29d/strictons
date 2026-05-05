import { z } from 'zod';

/**
 * Schema for the payload a hotel admin submits when inviting a team member.
 *
 * Consumed by `apps/partners/app/(protected)/members/actions.ts` (commit 11).
 *
 * `is_admin` is intentionally NOT part of this input — Phase 2's
 * `set_first_invitee_admin` BEFORE-INSERT trigger flips it true for the
 * very first member of a hotel, and admin-side promote/demote is out of
 * scope for Phase 3 per the plan §10. New invitees are non-admins by
 * default; only the trigger may produce an admin row at INSERT time.
 */
export const InviteHotelMemberInputSchema = z.object({
  email: z.email(),
  hotelId: z.uuid(),
});
export type InviteHotelMemberInput = z.infer<typeof InviteHotelMemberInputSchema>;

/**
 * Schema for the payload a business admin submits when inviting a team member.
 *
 * Consumed by `apps/partners/app/(protected)/members/actions.ts` (commit 11).
 * Symmetric to InviteHotelMemberInputSchema.
 */
export const InviteBusinessMemberInputSchema = z.object({
  email: z.email(),
  businessId: z.uuid(),
});
export type InviteBusinessMemberInput = z.infer<typeof InviteBusinessMemberInputSchema>;

/**
 * Schema for the payload an admin submits to revoke a member.
 *
 * Consumed by `apps/partners/app/(protected)/members/actions.ts` (commit 11).
 *
 * The membership table the row belongs to (hotel_users vs business_users)
 * is encoded by which Server Action gets called, not by a discriminator
 * in this payload. Two separate actions, two separate routes.
 */
export const RevokeMemberInputSchema = z.object({
  membershipId: z.uuid(),
});
export type RevokeMemberInput = z.infer<typeof RevokeMemberInputSchema>;
