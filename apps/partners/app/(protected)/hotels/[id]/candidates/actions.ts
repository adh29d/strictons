'use server';

import { revalidatePath } from 'next/cache';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServerClient } from '@strictons/db/server';
import { getMembershipSet } from '@strictons/db/roles';
import { writeAuditLog } from '@strictons/db/audit';
import {
  ApproveCandidateListInputSchema,
  ManualCandidateInputSchema,
  RemoveCandidateInputSchema,
} from '@strictons/types/candidates';
import type { HotelApprovalState } from '@strictons/types/hotels';
import type { AddCandidateState, ApproveListState, RemoveCandidateState } from './types';

/**
 * Phase 6 partners-side (hotel-admin) candidate-list Server Actions
 * (PHASE_6_PLAN.md §3.3). Three actions:
 *
 *   - addCandidateManualHotel   (hotel adds a manual candidate)
 *   - removeCandidateAsHotel    (hotel soft-deletes a candidate)
 *   - approveCandidateList      (hotel approves the list, with_hotel → approved)
 *
 * Conventions (Phase 2/4/5 locked):
 *
 *   - All mutations go through createServerClient (cookie-based,
 *     authenticated). RLS is the access boundary, per the Phase 2
 *     locked decision for hotel-side writes. Migration 15's policies
 *     gate row shape (insert source='manual'+proposed_by=auth.uid();
 *     update soft-delete shape; hotels approve with_hotel → approved).
 *     The action layer adds the `approval_state` precondition for
 *     add/remove (RLS does not gate on hotels.approval_state for the
 *     candidate_businesses policies — defense in depth).
 *   - writeAuditLog uses the shared @strictons/db/audit helper, which
 *     routes through service-role (audit_log INSERT is service-role
 *     only per Phase 2). actor_role is always 'hotel_admin'.
 *   - 'use server' rule: every export is an async function. Types live
 *     in ./types.ts; input schemas in @strictons/types/candidates.
 *   - withServerActionInstrumentation wraps every action body; formData
 *     is NOT passed to the wrapper (candidate fields include PII).
 *   - Phase 5 SELECT-then-act precondition pattern: SELECT the hotel
 *     row (and candidate row for remove), inspect, then write.
 *   - Audit-logged on every outcome (success + per-reason failure) via
 *     writeAuditLog. Reason vocabularies per PHASE_6_PLAN.md §8.
 *   - revalidatePath called for both literal routes on success:
 *     '/hotels/[id]' and '/hotels/[id]/candidates'.
 *   - entity_hotel_id on a hotel_not_found audit is `null`, not the
 *     submitted hotelId — audit_log.entity_hotel_id is a FK to
 *     hotels(id), and a non-existent id would FK-violate the audit
 *     INSERT. Matches the commit-7 follow-up fix on the admin-side
 *     actions (apps/admin commit 48ef521).
 */

const HOTEL_ROUTE = '/hotels/[id]';
const CANDIDATES_ROUTE = '/hotels/[id]/candidates';

const HOTEL_EDITABLE_STATES: ReadonlySet<HotelApprovalState> = new Set([
  'candidate_list_with_hotel',
  'paused_awaiting_hotel_response',
]);

function revalidateCandidateRoutes(): void {
  revalidatePath(HOTEL_ROUTE);
  revalidatePath(CANDIDATES_ROUTE);
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function zodErrorSummary(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): {
  message: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || '(form)';
    if (!(field in fieldErrors)) fieldErrors[field] = issue.message;
  }
  return {
    message: issues
      .map((i) => `${i.path.map(String).join('.') || '(form)'}: ${i.message}`)
      .join('; '),
    fieldErrors,
  };
}

/**
 * Resolve the authenticated user and return the cookie-based supabase
 * client + the user's memberships. The admin-scope check is split out
 * (assertHotelAdmin) so the caller can run zod validation between the
 * two steps and audit a `validation_failed` outcome with a real
 * actor_user_id (audit_log.actor_user_id is NOT NULL).
 *
 * Defence in depth: this helper authenticates only; the admin-scope
 * check at assertHotelAdmin AND RLS gating at the DB (mig 15) are the
 * other two layers. Mirrors apps/partners/app/(protected)/members/
 * actions.ts in spirit, but splits the two checks because the
 * candidate-list actions audit validation_failed (admin-side
 * precedent) and members/actions doesn't.
 */
async function authenticate(): Promise<
  | {
      kind: 'ok';
      supabase: Awaited<ReturnType<typeof createServerClient>>;
      userId: string;
      memberships: Awaited<ReturnType<typeof getMembershipSet>>;
    }
  | { kind: 'error'; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { kind: 'error', error: 'Not signed in.' };
  }
  const memberships = await getMembershipSet(supabase, user.id);
  return { kind: 'ok', supabase, userId: user.id, memberships };
}

function isHotelAdmin(
  memberships: Awaited<ReturnType<typeof getMembershipSet>>,
  hotelId: string,
): boolean {
  return memberships.roles.some((role) => role.kind === 'hotel_admin' && role.hotelId === hotelId);
}

// ----------------------------------------------------------------------------
// addCandidateManualHotel
// ----------------------------------------------------------------------------

export async function addCandidateManualHotel(
  _prev: AddCandidateState,
  formData: FormData,
): Promise<AddCandidateState> {
  return withServerActionInstrumentation(
    'partners:addCandidateManualHotel',
    async (): Promise<AddCandidateState> => {
      // ---- Auth gate (no hotel-scope yet) ----
      // Split into authenticate() + isHotelAdmin() so the zod parse
      // can run between the two and audit a `validation_failed`
      // outcome with a real actor_user_id.
      const auth = await authenticate();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { supabase, userId, memberships } = auth;

      const rawDistanceM = optionalString(formData.get('distanceM'));
      const parsed = ManualCandidateInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
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
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      // ---- Hotel-admin scope check (on the parsed hotelId) ----
      // Returns early WITHOUT an audit row — matches the requireStaff
      // pattern on the admin side (the not-staff branch returns early
      // without an audit; the middleware already gated the route, and
      // a scope mismatch on a UUID-valid hotelId is most often a stale
      // form post).
      if (!isHotelAdmin(memberships, input.hotelId)) {
        return { error: 'You do not admin this hotel.' };
      }

      // ---- SELECT the hotel for approval_state precondition ----
      // RLS does NOT gate on hotels.approval_state for the hotel-admin
      // INSERT policy on candidate_businesses (migration 15 only checks
      // is_hotel_admin + row shape). The action narrows to
      // {with_hotel, paused_awaiting_hotel_response} here as the only
      // enforcement point. Do not "tighten" RLS to add an
      // approval_state check — the action layer is the agreed gate.
      const { data: hotelRow, error: hotelLookupError } = await supabase
        .from('hotels')
        .select('id, approval_state')
        .eq('id', input.hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      const approvalState = hotelRow.approval_state as HotelApprovalState;
      if (!HOTEL_EDITABLE_STATES.has(approvalState)) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_add_failed',
          entity_type: 'candidate_businesses',
          entity_id: crypto.randomUUID(),
          entity_hotel_id: input.hotelId,
          after: {
            reason: 'list_not_editable',
            message: `current state: ${approvalState}`,
          },
        });
        return {
          error: 'The candidate list is not open for hotel edits right now.',
        };
      }

      // ---- INSERT via the authenticated (cookie-based) client ----
      // RLS policy candidate_businesses_insert_hotel_admin_manual (mig
      // 15) gates: is_hotel_admin AND source='manual' AND
      // proposed_by=auth.uid() AND removed_at IS NULL AND
      // status='proposed' AND linked_business_id IS NULL.
      const { data: inserted, error: insertError } = await supabase
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
          proposed_by: userId,
          status: 'proposed',
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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
        actor_user_id: userId,
        actor_role: 'hotel_admin',
        action: 'candidate_added',
        entity_type: 'candidate_businesses',
        entity_id: inserted.id,
        entity_hotel_id: input.hotelId,
        after: { source: 'manual', name: input.name, proposed_by_hotel: true },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate added.', candidateId: inserted.id };
    },
  );
}

// ----------------------------------------------------------------------------
// removeCandidateAsHotel
// ----------------------------------------------------------------------------

export async function removeCandidateAsHotel(
  _prev: RemoveCandidateState,
  formData: FormData,
): Promise<RemoveCandidateState> {
  return withServerActionInstrumentation(
    'partners:removeCandidateAsHotel',
    async (): Promise<RemoveCandidateState> => {
      const auth = await authenticate();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { supabase, userId, memberships } = auth;

      const parsed = RemoveCandidateInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
        candidateId: (formData.get('candidateId') ?? '').toString(),
        reason: optionalString(formData.get('reason')),
      });

      if (!parsed.success) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      if (!isHotelAdmin(memberships, hotelId)) {
        return { error: 'You do not admin this hotel.' };
      }

      // ---- SELECT the hotel for approval_state precondition ----
      const { data: hotelRow, error: hotelLookupError } = await supabase
        .from('hotels')
        .select('id, approval_state')
        .eq('id', hotelId)
        .maybeSingle();
      if (hotelLookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: null,
          after: {
            reason: 'hotel_not_found',
            message: hotelLookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      const approvalState = hotelRow.approval_state as HotelApprovalState;
      if (!HOTEL_EDITABLE_STATES.has(approvalState)) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'list_not_editable',
            message: `current state: ${approvalState}`,
          },
        });
        return {
          error: 'The candidate list is not open for hotel edits right now.',
        };
      }

      // ---- SELECT the candidate row ----
      const { data: candidateRow, error: lookupError } = await supabase
        .from('candidate_businesses')
        .select('id, hotel_id, removed_at')
        .eq('id', candidateId)
        .maybeSingle();
      if (lookupError || !candidateRow) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      // ---- Cross-hotel id smuggling check ----
      // Same user-facing error as not-found so the existence of the
      // other hotel's row isn't leaked. RLS would also reject the
      // UPDATE (is_hotel_admin gates on candidateRow.hotel_id, which
      // is the OTHER hotel's id), but the explicit check produces a
      // structured audit reason rather than an opaque update failure.
      if (candidateRow.hotel_id !== hotelId) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      if (candidateRow.removed_at !== null) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
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

      // ---- Soft-delete UPDATE via the authenticated client ----
      // RLS policy candidate_businesses_update_hotel_admin (mig 15)
      // gates: status='removed_by_hotel' AND removed_at IS NOT NULL
      // AND removed_by = auth.uid(). Column GRANT scopes the writable
      // columns to (status, removed_at, removed_by, removal_reason).
      const removedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('candidate_businesses')
        .update({
          removed_at: removedAt,
          removed_by: userId,
          removal_reason: reason ?? null,
          status: 'removed_by_hotel',
        })
        .eq('id', candidateId);

      if (updateError) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_remove_failed',
          entity_type: 'candidate_businesses',
          entity_id: candidateId,
          entity_hotel_id: hotelId,
          after: { reason: 'update_failed', message: updateError.message },
        });
        return { error: 'Could not remove the candidate. Please try again.' };
      }

      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'hotel_admin',
        action: 'candidate_removed',
        entity_type: 'candidate_businesses',
        entity_id: candidateId,
        entity_hotel_id: hotelId,
        after: {
          reason: reason ?? null,
          removed_at: removedAt,
          status: 'removed_by_hotel',
        },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate removed.' };
    },
  );
}

// ----------------------------------------------------------------------------
// approveCandidateList
// ----------------------------------------------------------------------------

export async function approveCandidateList(
  _prev: ApproveListState,
  formData: FormData,
): Promise<ApproveListState> {
  return withServerActionInstrumentation(
    'partners:approveCandidateList',
    async (): Promise<ApproveListState> => {
      const auth = await authenticate();
      if (auth.kind === 'error') {
        return { error: auth.error };
      }
      const { supabase, userId, memberships } = auth;

      const parsed = ApproveCandidateListInputSchema.safeParse({
        hotelId: (formData.get('hotelId') ?? '').toString(),
      });

      if (!parsed.success) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_list_approve_failed',
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

      if (!isHotelAdmin(memberships, hotelId)) {
        return { error: 'You do not admin this hotel.' };
      }

      // ---- SELECT the hotel for approval_state precondition ----
      // Approval is one-way for the hotel: only candidate_list_with_hotel
      // permits approve. Staff reopen is the only path back.
      const { data: hotelRow, error: lookupError } = await supabase
        .from('hotels')
        .select('id, approval_state')
        .eq('id', hotelId)
        .maybeSingle();
      if (lookupError || !hotelRow) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_list_approve_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: null,
          after: {
            reason: 'hotel_not_found',
            message: lookupError?.message ?? null,
          },
        });
        return { error: 'Hotel not found.' };
      }

      if (hotelRow.approval_state !== 'candidate_list_with_hotel') {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_list_approve_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: {
            reason: 'wrong_state',
            message: `current state: ${hotelRow.approval_state}`,
          },
        });
        return { error: 'The candidate list is not currently with the hotel for review.' };
      }

      // ---- UPDATE via the authenticated client ----
      // RLS policy hotels_update_admin_approve_candidate_list (mig 15)
      // gates: is_hotel_admin AND USING approval_state='with_hotel'
      // AND CHECK approval_state='approved' AND
      // candidate_list_approved_at IS NOT NULL. Column GRANT scopes
      // writable columns to (approval_state, candidate_list_approved_at).
      // The hotels BEFORE UPDATE trigger from mig 15 permits exactly
      // this transition for authenticated callers.
      const approvedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('hotels')
        .update({
          approval_state: 'candidate_list_approved',
          candidate_list_approved_at: approvedAt,
        })
        .eq('id', hotelId);

      if (updateError) {
        await writeAuditLog({
          actor_user_id: userId,
          actor_role: 'hotel_admin',
          action: 'candidate_list_approve_failed',
          entity_type: 'hotels',
          entity_id: hotelId,
          entity_hotel_id: hotelId,
          after: { reason: 'update_failed', message: updateError.message },
        });
        return { error: 'Could not approve the list. Please try again.' };
      }

      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'hotel_admin',
        action: 'candidate_list_approved',
        entity_type: 'hotels',
        entity_id: hotelId,
        entity_hotel_id: hotelId,
        after: { approved_at: approvedAt },
      });

      revalidateCandidateRoutes();
      return { ok: true, message: 'Candidate list approved.' };
    },
  );
}
