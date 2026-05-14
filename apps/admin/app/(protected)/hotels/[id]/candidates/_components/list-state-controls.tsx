'use client';

import { useActionState, useId } from 'react';
import type { HotelApprovalState } from '@strictons/types/hotels';
import { markCandidateListReadyForReview, reopenCandidateList } from '../actions';
import type { MarkReadyState, ReopenState } from '../types';

const MARK_READY_INITIAL: MarkReadyState = {};
const REOPEN_INITIAL: ReopenState = {};

type Props = {
  hotelId: string;
  approvalState: HotelApprovalState;
};

/**
 * List-state controls, gated on hotels.approval_state — the source of
 * truth for the candidate-list lifecycle (§0.1 / commit 1):
 *
 *   - candidate_list_drafted    → "Mark ready for hotel review"
 *   - candidate_list_with_hotel → "Reopen" (target: drafted or
 *                                 with_hotel — the latter is a no-op
 *                                 the action rejects, so the selector
 *                                 only offers drafted here)
 *   - candidate_list_approved   → "Reopen" (target: drafted or
 *                                 with_hotel)
 *   - any other state           → no actions (the candidate list is
 *                                 not in a staff-actionable phase)
 *
 * Each form is useActionState against its Server Action. The
 * role="status" success message is the deterministic post-action
 * signal; the page is force-dynamic so the action's revalidatePath
 * re-renders the page header's status badge.
 */
export function ListStateControls({ hotelId, approvalState }: Props): React.ReactElement {
  if (approvalState === 'candidate_list_drafted') {
    return <MarkReadyForm hotelId={hotelId} />;
  }
  if (
    approvalState === 'candidate_list_with_hotel' ||
    approvalState === 'candidate_list_approved'
  ) {
    return <ReopenForm hotelId={hotelId} approvalState={approvalState} />;
  }
  return (
    <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
      No list-status actions are available while the hotel is in this stage.
    </p>
  );
}

function MarkReadyForm({ hotelId }: { hotelId: string }): React.ReactElement {
  const [state, formAction, isPending] = useActionState<MarkReadyState, FormData>(
    markCandidateListReadyForReview,
    MARK_READY_INITIAL,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="hotelId" value={hotelId} />
      <p className="text-sm text-neutral-600">
        Hand the list to the hotel for review. This starts the 14-day approval window.
      </p>
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Updating…' : 'Mark ready for hotel review'}
      </button>
      {state.ok ? (
        <p role="status" className="text-sm text-green-700">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ReopenForm({
  hotelId,
  approvalState,
}: {
  hotelId: string;
  approvalState: HotelApprovalState;
}): React.ReactElement {
  const [state, formAction, isPending] = useActionState<ReopenState, FormData>(
    reopenCandidateList,
    REOPEN_INITIAL,
  );
  const targetId = useId();
  const reasonId = useId();

  // candidate_list_with_hotel → with_hotel would be a no-op the action
  // rejects (invalid_target_state). From with_hotel the only useful
  // target is drafted; from approved both are useful.
  const offerWithHotelTarget = approvalState === 'candidate_list_approved';

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="hotelId" value={hotelId} />
      <p className="text-sm text-neutral-600">
        Reopen the list for staff editing. The hotel will need to review again.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor={targetId} className="text-sm font-medium">
          Reopen to
        </label>
        <select
          id={targetId}
          name="targetState"
          defaultValue="candidate_list_drafted"
          className="self-start rounded border border-neutral-300 px-3 py-2"
        >
          <option value="candidate_list_drafted">Draft — staff editing</option>
          {offerWithHotelTarget ? (
            <option value="candidate_list_with_hotel">With hotel for review</option>
          ) : null}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-sm font-medium">
          Reason <span className="text-neutral-400">(optional)</span>
        </label>
        <input
          id={reasonId}
          name="reason"
          type="text"
          autoComplete="off"
          placeholder="e.g. hotel asked to add three more businesses"
          className="rounded border border-neutral-300 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Reopening…' : 'Reopen list'}
      </button>
      {state.ok ? (
        <p role="status" className="text-sm text-green-700">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
