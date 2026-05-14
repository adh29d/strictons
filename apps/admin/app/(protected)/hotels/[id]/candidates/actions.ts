'use server';

import { revalidatePath } from 'next/cache';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServiceRoleClient } from '@strictons/db/client';
import { writeAuditLog } from '@strictons/db/audit';
import {
  ManualCandidateInputSchema,
  MarkListReadyForReviewInputSchema,
  RemoveCandidateInputSchema,
  ReopenCandidateListInputSchema,
} from '@strictons/types/candidates';
import { requireStaff } from '@/lib/require-staff';
import type { AddCandidateState, MarkReadyState, RemoveCandidateState, ReopenState } from './types';

/**
 * Phase 6 admin-side candidate-list Server Actions (PHASE_6_PLAN.md
 * §3.1). This commit lands four of the six admin actions:
 *
 *   - addCandidateManualStaff
 *   - removeCandidateAsStaff
 *   - markCandidateListReadyForReview
 *   - reopenCandidateList
 *
 * addCandidateFromGooglePlaces (commit 6) and uploadCandidateCsv
 * (commit 7) follow.
 *
 * Conventions (Phase 4/5 locked):
 *
 *   - 'use server' rule: every export is an async function. Constants
 *     and type aliases live in ./types.ts (state shapes) and
 *     @strictons/types/candidates (input schemas). Non-exported helpers
 *     below are fine — only EXPORTS must be async functions.
 *   - requireStaff() gate: defence in depth behind the (protected)
 *     middleware. The not-staff branch returns early WITHOUT an audit
 *     row, matching the Phase 5 lived pattern (the middleware already
 *     gated the route; the action's check is a backstop).
 *   - withServerActionInstrumentation wraps every action body.
 *     `formData` is NOT passed to the wrapper — candidate fields
 *     include contact_email and phone (PII), and the wrapper attaches
 *     every form field as a Sentry event extra.
 *   - Writes go through createServiceRoleClient() per the Phase 2
 *     locked decision (no FOR ALL is_strictons_staff() policies on
 *     candidate_businesses; Strictons-side writes route through
 *     service-role). createServiceRoleClient() is called inside each
 *     action body, never at module scope (Phase 3 module-instance-split
 *     gotcha).
 *   - Preconditions use the Phase 5 SELECT-then-act pattern: SELECT the
 *     row, inspect it, then write — rather than an UPDATE ... WHERE +
 *     zero-rows check.
 *   - Audit-logged on every outcome (success + per-reason failure) via
 *     writeAuditLog from @strictons/db/audit. The reason vocabularies
 *     are PHASE_6_PLAN.md §8 (extended this commit: validation_failed
 *     added to three failure events, hotel_not_found added to the two
 *     list-state failure events — see the §8 table).
 *   - revalidatePath is called for BOTH literal routes on every
 *     successful mutation: '/hotels/[id]' and '/hotels/[id]/candidates'.
 *   - entity_id for a failure audit where no entity exists yet uses
 *     crypto.randomUUID() (audit_log.entity_id is NOT NULL); the real
 *     id is used once it exists.
 */

const HOTEL_ROUTE = '/hotels/[id]';
const CANDIDATES_ROUTE = '/hotels/[id]/candidates';

/** revalidate both literal routes that render candidate-list state. */
function revalidateCandidateRoutes(): void {
  revalidatePath(HOTEL_ROUTE);
  revalidatePath(CANDIDATES_ROUTE);
}

/** A FormData entry, normalised: a non-empty trimmed string, or undefined. */
function optionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Summarise a zod error into a top-of-form message + per-field map. */
function zodErrorSummary(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): {
  message: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || '(form)';
    // First issue per field wins — keeps the per-field message stable.
    if (!(field in fieldErrors)) fieldErrors[field] = issue.message;
  }
  return {
    message: issues
      .map((i) => `${i.path.map(String).join('.') || '(form)'}: ${i.message}`)
      .join('; '),
    fieldErrors,
  };
}

// ----------------------------------------------------------------------------
// addCandidateManualStaff
// ----------------------------------------------------------------------------

export async function addCandidateManualStaff(
  _prev: AddCandidateState,
  formData: FormData,
): Promise<AddCandidateState> {
  return withServerActionInstrumentation(
    'admin:addCandidateManualStaff',
    async (): Promise<AddCandidateState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const rawHotelId = (formData.get('hotelId') ?? '').toString();
      const rawDistanceM = optionalString(formData.get('distanceM'));
      const parsed = ManualCandidateInputSchema.safeParse({
        hotelId: rawHotelId,
        name: (formData.get('name') ?? '').toString(),
        address: optionalString(formData.get('address')),
        category: optionalString(formData.get('category')),
        phone: optionalString(formData.get('phone')),
        website: optionalString(formData.get('website')),
        contactEmail: optionalString(formData.get('contactEmail')),
        distanceM: rawDistanceM === undefined ? undefined : Number(rawDistanceM),
      });

      if (!parsed.success) {
        const summary = zodErrorSummary(parsed.error.issues);
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_add_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: { reason: 'validation_failed', message: summary.message },
        });
        return {
          error: 'Please fix the errors below.',
          fieldErrors: summary.fieldErrors,
        };
      }

      const input = parsed.data;
      const service = createServiceRoleClient();

      // ---- SELECT the hotel to confirm it exists ----
      const { data: hotelRow, error: hotelLookupError } = await service
        .from('hotels')
        .select('id')
        .eq('id', input.hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_add_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: {
            reason: 'hotel_not_found',
            message: hotelLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      // ---- INSERT the candidate ----
      const { data: inserted, error: insertError } = await service
        .from('candidate_businesses')
        .insert({
          hotel_id: input.hotelId,
          source: 'manual',
          name: input.name,
          address: input.address ?? null,
          category: input.category ?? null,
          distance_m: input.distanceM ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          contact_email: input.contactEmail ?? null,
          proposed_by: staffUserId,
          status: 'proposed',
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_add_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: input.hotelId,
          after: {
            reason: 'insert_failed',
            message: insertError?.message ?? 'unknown',
          },
        });
        return { error: 'Could not add candidate. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'candidate_added',
        entity_type: 'candidate_businesses',
        entity_id: inserted.id,
        entity_hotel_id: input.hotelId,
        after: { source: 'manual', name: input.name },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate added.', candidateId: inserted.id };
    },
  );
}

// ----------------------------------------------------------------------------
// removeCandidateAsStaff
// ----------------------------------------------------------------------------

export async function removeCandidateAsStaff(
  _prev: RemoveCandidateState,
  formData: FormData,
): Promise<RemoveCandidateState> {
  return withServerActionInstrumentation(
    'admin:removeCandidateAsStaff',
    async (): Promise<RemoveCandidateState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const parsed = RemoveCandidateInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
        candidateId: (formData.get('candidateId') ?? '').toString(),
        reason: optionalString(formData.get('reason')),
      });

      if (!parsed.success) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: {
            reason: 'validation_failed',
            message: zodErrorSummary(parsed.error.issues).message,
          },
        });
        return { error: 'Invalid remove request.' };
      }

      const { hotelId, candidateId, reason } = parsed.data;
      const service = createServiceRoleClient();

      // ---- SELECT the candidate row ----
      const { data: candidateRow, error: lookupError } = await service
        .from('candidate_businesses')
        .select('id, hotel_id, removed_at')
        .eq('id', candidateId)
        .maybeSingle();
      if (lookupError || !candidateRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'not_found',
            message: lookupError?.message ?? null,
          },
        });
        return { error: 'Candidate not found.' };
      }

      // ---- Cross-hotel id smuggling check (Phase 5 precedent) ----
      // The form on hotel A's page must not be able to remove a candidate
      // belonging to hotel B. Surface the same user-facing error as
      // not-found so the existence of the other hotel's row isn't leaked.
      if (candidateRow.hotel_id !== hotelId) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'cross_hotel_smuggling',
            submitted_hotel_id: hotelId,
            actual_hotel_id: candidateRow.hotel_id,
          },
        });
        return { error: 'Candidate not found.' };
      }

      // ---- Reject an already-removed row ----
      if (candidateRow.removed_at !== null) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'already_removed',
            removed_at: candidateRow.removed_at,
          },
        });
        return { error: 'This candidate has already been removed.' };
      }

      // ---- Soft-delete UPDATE ----
      // status='removed_by_strictons' is the staff-side removal value
      // (Q3); removed_at + removed_by are the canonical "is removed"
      // filter. removed_at is computed in JS and reused in the audit
      // `after` so the two agree exactly.
      const removedAt = new Date().toISOString();
      const { error: updateError } = await service
        .from('candidate_businesses')
        .update({
          removed_at: removedAt,
          removed_by: staffUserId,
          removal_reason: reason ?? null,
          status: 'removed_by_strictons',
        })
        .eq('id', candidateId);

      if (updateError) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: { reason: 'update_failed', message: updateError.message },
        });
        return { error: 'Could not remove the candidate. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'candidate_removed',
        entity_type: 'candidate_businesses',
        entity_id: candidateId,
        entity_hotel_id: hotelId,
        after: {
          reason: reason ?? null,
          removed_at: removedAt,
          status: 'removed_by_strictons',
        },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate removed.' };
    },
  );
}

// ----------------------------------------------------------------------------
// markCandidateListReadyForReview
// ----------------------------------------------------------------------------

const APPROVAL_DUE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export async function markCandidateListReadyForReview(
  _prev: MarkReadyState,
  formData: FormData,
): Promise<MarkReadyState> {
  return withServerActionInstrumentation(
    'admin:markCandidateListReadyForReview',
    async (): Promise<MarkReadyState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const parsed = MarkListReadyForReviewInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
      });

      if (!parsed.success) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_mark_ready_for_review_failed',
          entity_type: 'hotels',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: {
            reason: 'validation_failed',
            message: zodErrorSummary(parsed.error.issues).message,
          },
        });
        return { error: 'Invalid request.' };
      }

      const { hotelId } = parsed.data;
      const service = createServiceRoleClient();

      // ---- SELECT the hotel's current approval_state ----
      const { data: hotelRow, error: lookupError } = await service
        .from('hotels')
        .select('id, approval_state')
        .eq('id', hotelId)
        .maybeSingle();
      if (lookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_mark_ready_for_review_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'hotel_not_found',
            message: lookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      // ---- Precondition: must be in candidate_list_drafted ----
      if (hotelRow.approval_state !== 'candidate_list_drafted') {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_mark_ready_for_review_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'wrong_state',
            message: `current state: ${hotelRow.approval_state}`,
          },
        });
        return { error: 'List is not in the drafted state.' };
      }

      // ---- UPDATE: drafted -> with_hotel, set the 14-day due date ----
      // now() + interval '14 days' computed in JS for the supabase-js
      // update (negligible clock skew vs Postgres now() over a 14-day
      // window). The migration-15 hotels trigger lets service-role make
      // any approval_state transition (current_user='service_role' →
      // bypass).
      const dueAt = new Date(Date.now() + APPROVAL_DUE_WINDOW_MS).toISOString();
      const { error: updateError } = await service
        .from('hotels')
        .update({
          approval_state: 'candidate_list_with_hotel',
          candidate_list_approval_due_at: dueAt,
        })
        .eq('id', hotelId);

      if (updateError) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_mark_ready_for_review_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: { reason: 'update_failed', message: updateError.message },
        });
        return { error: 'Could not update the list. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'candidate_list_marked_ready_for_review',
        entity_type: 'hotels',
        entity_id: hotelId,
        entity_hotel_id: hotelId,
        after: { candidate_list_approval_due_at: dueAt },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'List ready for hotel review.' };
    },
  );
}

// ----------------------------------------------------------------------------
// reopenCandidateList
// ----------------------------------------------------------------------------

const REOPENABLE_STATES = ['candidate_list_approved', 'candidate_list_with_hotel'] as const;

export async function reopenCandidateList(
  _prev: ReopenState,
  formData: FormData,
): Promise<ReopenState> {
  return withServerActionInstrumentation(
    'admin:reopenCandidateList',
    async (): Promise<ReopenState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const parsed = ReopenCandidateListInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
        targetState: (formData.get('targetState') ?? '').toString(),
        reason: optionalString(formData.get('reason')),
      });

      if (!parsed.success) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_reopen_failed',
          entity_type: 'hotels',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: {
            reason: 'validation_failed',
            message: zodErrorSummary(parsed.error.issues).message,
          },
        });
        return { error: 'Invalid reopen request.' };
      }

      const { hotelId, targetState, reason } = parsed.data;
      const service = createServiceRoleClient();

      // ---- SELECT the hotel's current approval_state ----
      const { data: hotelRow, error: lookupError } = await service
        .from('hotels')
        .select('id, approval_state')
        .eq('id', hotelId)
        .maybeSingle();
      if (lookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_reopen_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'hotel_not_found',
            message: lookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      const fromState = hotelRow.approval_state;

      // ---- Precondition: must be reopenable (approved or with_hotel) ----
      if (!(REOPENABLE_STATES as readonly string[]).includes(fromState)) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_reopen_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: { reason: 'wrong_state', message: `current state: ${fromState}` },
        });
        return { error: 'List cannot be reopened from its current state.' };
      }

      // ---- No-op guard: reopening to the current state ----
      // invalid_target_state (PHASE_6_PLAN.md §8): targetState is
      // structurally valid (zod-checked against the two-value enum) but
      // equals the current state. Reachable only as
      // from=with_hotel, target=with_hotel — a real mis-click.
      if (targetState === fromState) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_reopen_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'invalid_target_state',
            message: `targetState ${targetState} equals current state`,
          },
        });
        return { error: 'The list is already in that state.' };
      }

      // ---- UPDATE: reopen to targetState ----
      // candidate_list_approved_at always cleared. candidate_list_
      // approval_due_at cleared only when reopening to drafted; when
      // reopening to with_hotel the existing due date is left alone
      // (staff is correcting course, not restarting the 14-day clock).
      const updatePayload: {
        approval_state: typeof targetState;
        candidate_list_approved_at: null;
        candidate_list_approval_due_at?: null;
      } = {
        approval_state: targetState,
        candidate_list_approved_at: null,
      };
      if (targetState === 'candidate_list_drafted') {
        updatePayload.candidate_list_approval_due_at = null;
      }

      const { error: updateError } = await service
        .from('hotels')
        .update(updatePayload)
        .eq('id', hotelId);

      if (updateError) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_list_reopen_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: { reason: 'update_failed', message: updateError.message },
        });
        return { error: 'Could not reopen the list. Please try again.' };
      }

      // ---- Success ----
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'candidate_list_reopened',
        entity_type: 'hotels',
        entity_id: hotelId,
        entity_hotel_id: hotelId,
        after: { from_state: fromState, to_state: targetState, reason: reason ?? null },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'List reopened.' };
    },
  );
}
