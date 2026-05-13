/**
 * Form state for the Phase 5 staff-initiated hotel-admin invite +
 * portal-access-link resend Server Actions on the hotel edit page.
 *
 * Sibling to actions.ts because that file has 'use server' at the top
 * and may only export async functions (Phase 3 gotcha — the runtime
 * check fires on first import, not at build, so the symptom is a 500
 * on first form submission rather than a build failure).
 *
 * The zod input schemas live in @strictons/types/hotel-admin-invites
 * per the Phase 4 precedent (hotel CRUD schemas live in
 * @strictons/types/hotels). This file carries the action-result
 * discriminated union and a per-field-errors shape, both of which are
 * admin-app-local UI concerns rather than transport contracts.
 *
 * Three-layer mutation pattern (Phase 4 locked):
 *
 *   1. revalidatePath('/hotels/[id]') — at the end of each successful
 *      action in actions.ts. Literal route, not the resolved path.
 *   2. state.ok and state.message returned from the action — the
 *      deterministic post-action signal for useActionState.
 *   3. state.message rendered as role="status" visible text in the
 *      Client Component (commit 5's responsibility).
 *
 * Per-field errors: only `email` is per-field at the moment (Surface 1
 * 23505 unique-violation on (hotel_id, invited_email)). Kept narrow
 * rather than Record<string, string> so the Client Component is
 * type-safe against typo'd field names.
 */

export type InviteHotelAdminFieldErrors = {
  email?: string;
};

export type InviteHotelAdminState = {
  ok?: true;
  /** Top-of-form generic error message. */
  error?: string;
  /** Per-field error messages keyed by field name. */
  fieldErrors?: InviteHotelAdminFieldErrors;
  /** Success message rendered as role="status" by the Client Component. */
  message?: string;
  /** Echo-back of the submitted email so the form preserves user input. */
  emailEcho?: string;
};

export type ResendPortalAccessLinkState = {
  ok?: true;
  /** Top-of-form generic error message. */
  error?: string;
  /** Success message rendered as role="status" by the Client Component. */
  message?: string;
};
