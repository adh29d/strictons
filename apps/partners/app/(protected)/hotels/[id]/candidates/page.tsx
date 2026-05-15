import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';
import type { HotelApprovalState } from '@strictons/types/hotels';
import { requireAuthSnapshot } from '@/lib/auth-cache';
import { AddCandidateManualFormHotel } from './_components/add-candidate-manual-form-hotel';
import { CandidateListHotelTable } from './_components/candidate-list-hotel-table';
import { ApproveListControls } from './_components/approve-list-controls';

/**
 * Phase 6 commit 10 — per-hotel candidate-list page for the partners
 * (hotel-admin) portal. PHASE_6_PLAN.md §5.
 *
 * Server Component. force-dynamic mirrors the admin-side candidates
 * page so revalidatePath('/hotels/[id]/candidates') from the partners
 * Server Actions re-renders the table without a hard reload.
 *
 * Auth + scoping (Phase 2 locked decision for hotel-side reads):
 *   - requireAuthSnapshot() gates on signed-in + at least one
 *     membership / strictons_staff via middleware-shape parity.
 *   - The caller must hold hotel_user or hotel_admin for THIS hotel
 *     (RLS would also reject the SELECT, but the explicit check
 *     produces a notFound() rather than an empty table on a wrong
 *     hotel id).
 *   - All page reads go through createServerClient (cookie-based
 *     authenticated client); RLS does the row-scoping at the DB
 *     (candidate_businesses_select_hotel → is_hotel_user; hotels
 *     select policy → is_hotel_user).
 *
 * approval_state surfaces (matches §5):
 *   - candidate_list_drafted: empty-state "Strictons is preparing
 *     your list" + no mutation surfaces.
 *   - candidate_list_with_hotel / paused_awaiting_hotel_response:
 *     candidate list visible + manual add form + per-row remove +
 *     (with_hotel only) approve control.
 *   - candidate_list_approved: candidate list visible read-only +
 *     "Your list is approved" locked banner + no mutation surfaces.
 *   - any other state: read-only list, neutral notice.
 *
 * Mutation surfaces are gated TWICE: page-level visibility + the
 * Server Action's own precondition check. Defense in depth — a stale
 * page open in a tab still can't drive a mutation that bypasses the
 * action's approval_state gate.
 */

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** Human-readable label for the approval_state pill. */
const APPROVAL_STATE_LABEL: Partial<Record<HotelApprovalState, string>> = {
  pending_design_meeting: 'Setting things up',
  design_meeting_held: 'Setting things up',
  candidate_list_drafted: 'Strictons is preparing your list',
  candidate_list_with_hotel: 'Ready for your review',
  candidate_list_approved: 'Approved',
  paused_awaiting_hotel_response: 'Awaiting your response',
};

function approvalStateLabel(state: HotelApprovalState): string {
  return APPROVAL_STATE_LABEL[state] ?? state.replace(/_/g, ' ');
}

const EDITABLE_STATES: ReadonlySet<HotelApprovalState> = new Set([
  'candidate_list_with_hotel',
  'paused_awaiting_hotel_response',
]);

export default async function HotelCandidatesPage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { id: hotelId } = await params;

  const { memberships } = await requireAuthSnapshot();
  const role = memberships.roles.find(
    (r) => (r.kind === 'hotel_admin' || r.kind === 'hotel_user') && r.hotelId === hotelId,
  );
  if (!role) {
    // Belt-and-braces — middleware gates on having SOME membership; this
    // page additionally requires membership of THIS hotel. RLS would
    // also block the SELECT below, but a 404 here is the cleaner
    // user-facing outcome than an empty page.
    notFound();
  }
  const isAdmin = role.kind === 'hotel_admin';

  const supabase = await createServerClient();
  const { data: hotel, error } = await supabase
    .from('hotels')
    .select('id, name, slug, approval_state, candidate_list_approval_due_at')
    .eq('id', hotelId)
    .maybeSingle();

  if (error || !hotel) {
    // RLS would have filtered the row even though the user has a
    // membership row in memory (a race window where the membership
    // was just revoked, or the hotel was deleted). Redirect to the
    // landing rather than 404 — the user is still signed in.
    redirect('/');
  }

  const approvalState = hotel.approval_state as HotelApprovalState;
  const dueAt = hotel.candidate_list_approval_due_at;
  const isEditable = EDITABLE_STATES.has(approvalState);
  const canApprove = approvalState === 'candidate_list_with_hotel';
  const isApproved = approvalState === 'candidate_list_approved';
  const isDrafted = approvalState === 'candidate_list_drafted';

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-neutral-600 underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Candidate list</h1>
        <p className="mt-1 text-sm text-neutral-700">{hotel.name}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-800">
            Status: {approvalStateLabel(approvalState)}
          </span>
          {approvalState === 'candidate_list_with_hotel' && dueAt ? (
            <span className="text-xs text-neutral-600">Please review by {dueAt.slice(0, 10)}</span>
          ) : null}
        </div>
      </header>

      {isDrafted ? (
        <section className="mb-10 rounded border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-700">
            Strictons is currently preparing your candidate list. You&apos;ll be notified by email
            when it&apos;s ready to review.
          </p>
        </section>
      ) : null}

      {isApproved ? (
        <section className="mb-10 rounded border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-900">
            Your candidate list is approved. To make further changes, contact Strictons.
          </p>
        </section>
      ) : null}

      {!isDrafted ? (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Current candidates</h2>
          <CandidateListHotelTable hotelId={hotel.id} showRemove={isAdmin && isEditable} />
        </section>
      ) : null}

      {isAdmin && isEditable ? (
        <section className="mb-10 border-t border-neutral-200 pt-8">
          <h2 className="mb-1 text-lg font-semibold">Add a candidate</h2>
          <p className="mb-4 text-sm text-neutral-600">
            Suggest a business Strictons should consider for your list.
          </p>
          <AddCandidateManualFormHotel hotelId={hotel.id} />
        </section>
      ) : null}

      {isAdmin && canApprove ? (
        <section className="border-t border-neutral-200 pt-8">
          <h2 className="mb-1 text-lg font-semibold">Approve your list</h2>
          <p className="mb-4 text-sm text-neutral-600">
            Once you&apos;re happy with the candidates above, approve the list so Strictons can move
            on to contacting them.
          </p>
          <ApproveListControls hotelId={hotel.id} hotelName={hotel.name} />
        </section>
      ) : null}

      {!isAdmin ? (
        <p className="mt-6 text-xs text-neutral-500">
          You&apos;re viewing this list as a hotel user. Hotel admins can add or remove candidates
          and approve the list.
        </p>
      ) : null}
    </main>
  );
}
