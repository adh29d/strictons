'use server';

import { revalidatePath } from 'next/cache';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServiceRoleClient } from '@strictons/db/client';
import { writeAuditLog } from '@strictons/db/audit';
import {
  AddFromGooglePlacesInputSchema,
  CsvUploadInputSchema,
  ManualCandidateInputSchema,
  MarkListReadyForReviewInputSchema,
  RemoveCandidateInputSchema,
  ReopenCandidateListInputSchema,
} from '@strictons/types/candidates';
import { requireStaff } from '@/lib/require-staff';
import { getPlaceDetails, PlacesConfigError, PlacesUpstreamError } from '@/lib/google-places';
import { parseCandidatesCsv, type CsvParseFailReason } from '@/lib/parse-candidates-csv';
import type {
  AddCandidateState,
  MarkReadyState,
  RemoveCandidateState,
  ReopenState,
  UploadCsvState,
} from './types';

/**
 * Phase 6 admin-side candidate-list Server Actions (PHASE_6_PLAN.md
 * §3.1). All six admin actions:
 *
 *   - addCandidateManualStaff        (commit 5)
 *   - removeCandidateAsStaff         (commit 5)
 *   - markCandidateListReadyForReview (commit 5)
 *   - reopenCandidateList            (commit 5)
 *   - addCandidateFromGooglePlaces   (commit 6)
 *   - uploadCandidateCsv             (commit 7)
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

// ----------------------------------------------------------------------------
// addCandidateFromGooglePlaces
// ----------------------------------------------------------------------------

export async function addCandidateFromGooglePlaces(
  _prev: AddCandidateState,
  formData: FormData,
): Promise<AddCandidateState> {
  return withServerActionInstrumentation(
    'admin:addCandidateFromGooglePlaces',
    async (): Promise<AddCandidateState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      const parsed = AddFromGooglePlacesInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
        placeId: (formData.get('placeId') ?? '').toString(),
        category: optionalString(formData.get('category')),
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
        return { error: 'Please fix the errors below.', fieldErrors: summary.fieldErrors };
      }

      const input = parsed.data;
      const service = createServiceRoleClient();

      // ---- SELECT the hotel to confirm it exists ----
      // Done before the Google call so a bad hotelId doesn't burn an API
      // request against the $200 free-credit budget.
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

      // ---- Place Details via the commit-3 adapter ----
      // The adapter is the single source of truth for fetch / cache /
      // typed errors. The action does NOT consume the rate-limit bucket
      // — that's the search Route Handler's job (§3.2). An ad-hoc
      // add-by-placeId is gated by the staff user having already seen
      // the search results, so it isn't a realistic abuse vector.
      //
      // PlacesConfigError (missing GOOGLE_PLACES_API_KEY) and
      // PlacesUpstreamError (HTTP non-2xx / timeout / network) are the
      // adapter's two typed errors. status === 404 → place_not_found;
      // any other PlacesUpstreamError → places_api_failed. Anything else
      // is genuinely unexpected — rethrow so Sentry captures it.
      let placeDetails;
      try {
        placeDetails = await getPlaceDetails(input.placeId);
      } catch (cause) {
        if (cause instanceof PlacesConfigError) {
          await writeAuditLog({
            actor_user_id: staffUserId,
            actor_role: 'strictons_staff',
            action: 'candidate_add_failed',
            entity_type: 'candidate_businesses',
            entity_id: crypto.randomUUID(),
            entity_hotel_id: input.hotelId,
            after: { reason: 'missing_api_key', message: cause.message },
          });
          return {
            error: 'Google Places is not configured. Please contact an administrator.',
          };
        }
        if (cause instanceof PlacesUpstreamError) {
          const reason = cause.status === 404 ? 'place_not_found' : 'places_api_failed';
          await writeAuditLog({
            actor_user_id: staffUserId,
            actor_role: 'strictons_staff',
            action: 'candidate_add_failed',
            entity_type: 'candidate_businesses',
            entity_id: crypto.randomUUID(),
            entity_hotel_id: input.hotelId,
            after: { reason, message: cause.message },
          });
          return {
            error:
              reason === 'place_not_found'
                ? 'That place could not be found on Google Places.'
                : 'Could not reach Google Places. Please try again.',
          };
        }
        throw cause;
      }

      // ---- INSERT the candidate ----
      // category: override wins, else derive from primaryType, else null.
      // distance_m is always null for a Google Places add — no distance
      // input, no distance in the v1 Places response, no hotel location
      // to measure from (PHASE_6_PLAN.md §3.1).
      const { data: inserted, error: insertError } = await service
        .from('candidate_businesses')
        .insert({
          hotel_id: input.hotelId,
          source: 'google_places',
          google_place_id: input.placeId,
          name: placeDetails.name,
          address: placeDetails.formattedAddress ?? null,
          category: input.category ?? placeDetails.primaryType ?? null,
          distance_m: null,
          phone: placeDetails.phone ?? null,
          website: placeDetails.websiteUri ?? null,
          proposed_by: staffUserId,
          status: 'proposed',
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        // Postgres 23505 from candidate_businesses_hotel_place_alive_uidx:
        // this place is already on the hotel's live list. Surface as a
        // per-field error on placeId per §3.1.
        if (insertError?.code === '23505') {
          await writeAuditLog({
            actor_user_id: staffUserId,
            actor_role: 'strictons_staff',
            action: 'candidate_add_failed',
            entity_type: 'candidate_businesses',
            entity_id: crypto.randomUUID(),
            entity_hotel_id: input.hotelId,
            after: {
              reason: 'duplicate_place',
              message: insertError.message,
              google_place_id: input.placeId,
            },
          });
          return {
            error: 'Please fix the errors below.',
            fieldErrors: {
              placeId: 'This place is already on the candidate list for this hotel.',
            },
          };
        }

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
        after: {
          source: 'google_places',
          name: placeDetails.name,
          google_place_id: input.placeId,
        },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate added.', candidateId: inserted.id };
    },
  );
}

// ----------------------------------------------------------------------------
// uploadCandidateCsv
// ----------------------------------------------------------------------------

/**
 * Maps the commit-4 parser's fatal `reason` discriminant to a frozen
 * §8 candidate_csv_import_failed audit reason. Exhaustive over
 * CsvParseFailReason so a future parser reason is a compile error here
 * rather than a silent miss. `empty` and `no_data_rows` both collapse
 * to `parse_failed` — they're "the file had nothing importable", which
 * §8's `parse_failed` covers.
 */
const PARSER_REASON_TO_AUDIT_REASON: Record<CsvParseFailReason, string> = {
  oversized: 'oversized',
  too_many_rows: 'too_many_rows',
  missing_name_column: 'missing_name_column',
  empty: 'parse_failed',
  no_data_rows: 'parse_failed',
  parse_failed: 'parse_failed',
};

export async function uploadCandidateCsv(
  _prev: UploadCsvState,
  formData: FormData,
): Promise<UploadCsvState> {
  return withServerActionInstrumentation(
    'admin:uploadCandidateCsv',
    async (): Promise<UploadCsvState> => {
      const auth = await requireStaff();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { userId: staffUserId } = auth;

      // ---- Validate the FormData shape ----
      // The hotelId is zod-validated; the file is validated as a File
      // instance (a File/Blob can't go through zod). Either failure is
      // validation_failed — a malformed FormData, distinct from the
      // per-row rejections the parser produces.
      const parsedInput = CsvUploadInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
      });
      const file = formData.get('file');
      if (!parsedInput.success || !(file instanceof File)) {
        const message = !parsedInput.success
          ? zodErrorSummary(parsedInput.error.issues).message
          : 'No CSV file was provided.';
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_csv_import_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: { reason: 'validation_failed', message },
        });
        return {
          error: !parsedInput.success ? 'Invalid request.' : 'Please choose a CSV file to upload.',
          rejected: [],
        };
      }
      const { hotelId } = parsedInput.data;

      const service = createServiceRoleClient();

      // ---- SELECT the hotel to confirm it exists ----
      // Before reading + parsing the file, so a bad hotelId doesn't
      // waste the parse. entity_hotel_id stays null here because the
      // hotel doesn't exist — a non-existent id would FK-violate the
      // audit_log.entity_hotel_id reference.
      const { data: hotelRow, error: hotelLookupError } = await service
        .from('hotels')
        .select('id')
        .eq('id', hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_csv_import_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: null,
          after: {
            reason: 'hotel_not_found',
            message: hotelLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.', rejected: [] };
      }

      // ---- Read + parse the file ----
      // The commit-4 parser owns the size cap (pre-parse, on the decoded
      // string's byte length), the row cap, the header check, and the
      // per-row validation. The action does not duplicate any of that —
      // it maps the parser's fatal `reason` to a frozen §8 audit reason.
      const content = await file.text();
      const parseResult = parseCandidatesCsv(content);

      if (!parseResult.ok) {
        const reason = PARSER_REASON_TO_AUDIT_REASON[parseResult.reason];
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_csv_import_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: hotelId,
          after: { reason, message: parseResult.error },
        });
        return { error: parseResult.error, rejected: [] };
      }

      const { rows, rejected } = parseResult;
      const rejectedCount = rejected.length;

      // ---- All rows failed per-row validation ----
      // The file parsed cleanly but every data row failed CsvRowSchema.
      // Per the plan-review round this is success-with-N=0, not failure:
      // §3.1's failure cases enumerate structural problems, and the
      // partial-success message template is grammatical at N=0. Skip the
      // batch INSERT entirely — there is nothing to insert.
      if (rows.length === 0) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_csv_imported',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: hotelId,
          after: { imported: 0, rejected: rejectedCount },
        });
        revalidateCandidateRoutes();
        return {
          ok: true,
          message: `Imported 0 candidates; ${rejectedCount} rows had errors and were skipped.`,
          importedCount: 0,
          rejectedCount,
          rejected,
        };
      }

      // ---- Single batch INSERT of the valid rows ----
      // No per-row best-effort: if the batch fails, no rows land; if it
      // succeeds, all valid rows land (§7.4). source / proposed_by /
      // status are uniform across every row.
      const insertPayloads = rows.map((row) => ({
        hotel_id: hotelId,
        source: 'csv' as const,
        name: row.name,
        address: row.address ?? null,
        category: row.category ?? null,
        distance_m: row.distance_m ?? null,
        phone: row.phone ?? null,
        website: row.website ?? null,
        contact_email: row.contact_email ?? null,
        proposed_by: staffUserId,
        status: 'proposed' as const,
      }));

      const { error: insertError } = await service
        .from('candidate_businesses')
        .insert(insertPayloads);

      if (insertError) {
        await writeAuditLog({
          actor_user_id: staffUserId,
          actor_role: 'strictons_staff',
          action: 'candidate_csv_import_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: hotelId,
          after: { reason: 'insert_failed', message: insertError.message },
        });
        // The parser's per-row rejections still surface so the user can
        // fix them before re-running (§7.4).
        return { error: 'Import failed; no rows inserted.', rejected };
      }

      // ---- Success ----
      const importedCount = rows.length;
      await writeAuditLog({
        actor_user_id: staffUserId,
        actor_role: 'strictons_staff',
        action: 'candidate_csv_imported',
        entity_type: 'candidate_businesses',
        entity_id: crypto.randomUUID(),
        entity_hotel_id: hotelId,
        after: { imported: importedCount, rejected: rejectedCount },
      });

      revalidateCandidateRoutes();
      return {
        ok: true,
        message:
          rejectedCount === 0
            ? `Imported ${importedCount} candidates.`
            : `Imported ${importedCount} candidates; ${rejectedCount} rows had errors and were skipped.`,
        importedCount,
        rejectedCount,
        rejected,
      };
    },
  );
}
