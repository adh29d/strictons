import { z } from 'zod';

/**
 * Schemas for the admin-side hotel CRUD (Phase 4 commit 9).
 *
 * Consumed by `apps/admin/app/(protected)/hotels/actions.ts`.
 *
 * Source-of-truth mirroring
 *
 *   HOTEL_APPROVAL_STATES mirrors the `public.hotel_approval_state` enum
 *   from migration 20260504100000_baseline.sql. The array is restated
 *   here (zod.enum needs a literal array; the generated DB types expose
 *   the enum as a TS union only, not a runtime value). The consumer
 *   asserts compile-time exhaustiveness against
 *   `Database['public']['Enums']['hotel_approval_state']` so the array
 *   cannot drift silently from the DB.
 *
 *   HOTEL_SLUG_REGEX mirrors `public.is_url_safe_slug(citext)` from the
 *   same migration:
 *     `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` with length 2-64.
 *   Slug is IMMUTABLE post-create per the
 *   `enforce_hotel_slug_immutable` trigger on hotels — HotelUpdateInputSchema
 *   omits slug entirely. The DB-level CHECK and UNIQUE still gate the
 *   create path; this regex is for early UX feedback only and DB errors
 *   are the security floor.
 *
 *   custom_domain accepts any non-empty string OR null (clears the field
 *   per brief §3.1). Per Q6 of the approved plan, no regex check —
 *   staff use the field with knowledge of what they're typing; DNS +
 *   Vercel attachment is a separate runbook step.
 */

// ----------------------------------------------------------------------------
// Enums
// ----------------------------------------------------------------------------

export const HOTEL_APPROVAL_STATES = [
  'pending_design_meeting',
  'design_meeting_held',
  'candidate_list_drafted',
  'candidate_list_with_hotel',
  'candidate_list_approved',
  'paused_awaiting_hotel_response',
  'businesses_pitching',
  'final_guide_with_hotel',
  'final_guide_approved',
  'in_print',
  'distributing',
] as const;

export type HotelApprovalState = (typeof HOTEL_APPROVAL_STATES)[number];

/**
 * Legal transitions per the state-machine doc in
 * 20260504100000_baseline.sql lines 33-70. Used for the non-blocking
 * UI warning when staff selects a transition that doesn't appear here.
 * The warning is informational only — every transition is permitted by
 * the DB and the Server Action; the audit log records every change.
 */
export const HOTEL_LEGAL_TRANSITIONS: Readonly<
  Record<HotelApprovalState, readonly HotelApprovalState[]>
> = {
  pending_design_meeting: ['design_meeting_held'],
  design_meeting_held: ['candidate_list_drafted'],
  candidate_list_drafted: ['candidate_list_with_hotel'],
  candidate_list_with_hotel: ['candidate_list_approved', 'paused_awaiting_hotel_response'],
  candidate_list_approved: ['businesses_pitching'],
  paused_awaiting_hotel_response: ['candidate_list_with_hotel', 'candidate_list_approved'],
  businesses_pitching: ['final_guide_with_hotel'],
  final_guide_with_hotel: ['final_guide_approved', 'paused_awaiting_hotel_response'],
  final_guide_approved: ['in_print'],
  in_print: ['distributing'],
  // distributing is terminal for the 12-month term; renewal creates a
  // new `guides` row rather than resetting state. No legal outbound
  // transitions.
  distributing: [],
};

export function isLegalTransition(from: HotelApprovalState, to: HotelApprovalState): boolean {
  if (from === to) return true;
  return HOTEL_LEGAL_TRANSITIONS[from].includes(to);
}

// ----------------------------------------------------------------------------
// Slug
// ----------------------------------------------------------------------------

/**
 * Mirrors `public.is_url_safe_slug(citext)` from migration 1. The DB
 * CHECK is the security floor; this regex provides early UX feedback
 * so a typo surfaces on submit rather than after a Server Action
 * round-trip.
 */
export const HOTEL_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

/**
 * Shared field shape. Create reuses this verbatim; Update derives from
 * it by omitting `slug` (per the immutability trigger) and adding
 * `id`. Per Q5 of the approved plan: shared base, two derived schemas.
 */
export const HotelBaseInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200, 'Name is too long.'),
  slug: z
    .string()
    .trim()
    .min(2, 'Slug must be at least 2 characters.')
    .max(64, 'Slug must be 64 characters or fewer.')
    .regex(
      HOTEL_SLUG_REGEX,
      'Slug must be lowercase letters, digits, and hyphens, starting and ending with a letter or digit.',
    ),
  contact_email: z.email('Enter a valid email address.'),
  approval_state: z.enum(HOTEL_APPROVAL_STATES),
  // null clears the field; empty string from a form input is normalised
  // to null before parsing in the Server Action (zod sees null cleanly
  // rather than '' which is a permitted-but-invalid value).
  custom_domain: z.string().min(1).nullable(),
});
export type HotelBaseInput = z.infer<typeof HotelBaseInputSchema>;

export const HotelCreateInputSchema = HotelBaseInputSchema;
export type HotelCreateInput = z.infer<typeof HotelCreateInputSchema>;

/**
 * Update payload. Slug is OMITTED because
 * `enforce_hotel_slug_immutable` raises on any UPDATE that changes it
 * — making slug part of the update payload would always either no-op
 * (matching slug) or fail at the DB. Omitting it from the schema makes
 * the form's UI honest: slug is rendered as read-only on the edit
 * page.
 *
 * All other fields are `.partial()` so the form can submit a subset
 * (e.g. only `approval_state` and `custom_domain` change).
 */
export const HotelUpdateInputSchema = HotelBaseInputSchema.omit({ slug: true }).partial().extend({
  id: z.uuid(),
});
export type HotelUpdateInput = z.infer<typeof HotelUpdateInputSchema>;
