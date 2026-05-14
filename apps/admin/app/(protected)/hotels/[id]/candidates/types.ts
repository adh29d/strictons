/**
 * Form state shapes for the Phase 6 admin-side candidate-list Server
 * Actions in ./actions.ts.
 *
 * Sibling to actions.ts because that file has 'use server' at the top
 * and may only export async functions (Phase 3 gotcha — the runtime
 * check fires on first import, not at build, so the symptom is a 500 on
 * first form submission rather than a build failure).
 *
 * The zod input schemas live in @strictons/types/candidates per the
 * Phase 4/5 precedent (input schemas are cross-package validation
 * contracts; state shapes are admin-app-local UI concerns). This file
 * carries only the action-result discriminated unions.
 *
 * Three-layer mutation pattern (Phase 4 locked):
 *
 *   1. revalidatePath at the end of each successful action — the
 *      literal routes '/hotels/[id]' and '/hotels/[id]/candidates',
 *      not the resolved paths.
 *   2. state.ok + state.message returned from the action — the
 *      deterministic post-action signal for useActionState.
 *   3. state.message rendered as role="status" visible text in the
 *      Client Component (commit 8's responsibility).
 */

/**
 * Result of addCandidateManualStaff.
 *
 * fieldErrors is Record<string, string> per PHASE_6_PLAN.md §3.1 — the
 * manual-add form has several user-typed fields (name, website,
 * contactEmail, distanceM) and a zod failure can land on any of them,
 * so the Client Component renders per-field errors keyed by field name.
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

export type MarkReadyState = {
  ok?: true;
  error?: string;
  message?: string;
};

export type ReopenState = {
  ok?: true;
  error?: string;
  message?: string;
};
