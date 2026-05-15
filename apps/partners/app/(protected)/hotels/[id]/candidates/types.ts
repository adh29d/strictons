/**
 * Form state shapes for the Phase 6 partners-side (hotel-admin)
 * candidate-list Server Actions in ./actions.ts.
 *
 * Sibling to actions.ts because that file has 'use server' at the top
 * and may only export async functions (Phase 3 gotcha — the runtime
 * check fires on first import). The zod input schemas live in
 * @strictons/types/candidates (shared cross-app); these are partners-
 * app-local UI concerns only.
 *
 * Mirrors the admin-side shapes in
 * apps/admin/app/(protected)/hotels/[id]/candidates/types.ts so a
 * future shared client component could consume either action's state
 * with the same renderer. Kept duplicated rather than shared because
 * the staff and hotel forms render different copy and field sets.
 */

export type AddCandidateState = {
  ok?: true;
  /** Top-of-form generic error message. */
  error?: string;
  /** Per-field error messages keyed by the input field name. */
  fieldErrors?: Record<string, string>;
  /** Success message rendered as role="status" by the Client Component. */
  message?: string;
  /** The new candidate_businesses row id, on success. */
  candidateId?: string;
};

export type RemoveCandidateState = {
  ok?: true;
  error?: string;
  message?: string;
};

export type ApproveListState = {
  ok?: true;
  error?: string;
  message?: string;
};
