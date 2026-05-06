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
 * `scope` is a discriminator that tells the Server Action which table
 * `membershipId` belongs to (`hotel_users` vs `business_users`). The
 * partners-app revoke button passes it explicitly from the row's
 * surrounding context — no need to look up which table the row lives
 * in by trial-and-error against both tables.
 */
export const RevokeMemberInputSchema = z.object({
  membershipId: z.uuid(),
  scope: z.enum(['hotel', 'business']),
});
export type RevokeMemberInput = z.infer<typeof RevokeMemberInputSchema>;
