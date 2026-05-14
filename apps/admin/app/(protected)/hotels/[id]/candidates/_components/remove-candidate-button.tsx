'use client';

import { useActionState, useId, useState } from 'react';
import { removeCandidateAsStaff } from '../actions';
import type { RemoveCandidateState } from '../types';

const INITIAL: RemoveCandidateState = {};

type Props = {
  hotelId: string;
  candidateId: string;
  candidateName: string;
};

/**
 * Per-row soft-delete affordance on the CandidateListTable. Each row
 * gets its own useActionState against removeCandidateAsStaff — the
 * Phase 5 per-row pattern (ResendPortalAccessLinkButton).
 *
 * The optional reason is collapsed behind a "Remove" button: clicking
 * "Remove" reveals a small reason input + a confirming "Remove
 * candidate" submit, so the common no-reason removal is one click and
 * a reason is still available without a separate modal.
 *
 * Three-layer mutation pattern, layer 3: on success the action's
 * revalidatePath re-renders CandidateListTable and this row
 * disappears from the alive view — so there is no lingering
 * role="status" text to render here (the row is simply gone). A
 * failure renders state.error inline.
 */
export function RemoveCandidateButton({
  hotelId,
  candidateId,
  candidateName,
}: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<RemoveCandidateState, FormData>(
    removeCandidateAsStaff,
    INITIAL,
  );
  const [expanded, setExpanded] = useState(false);
  const reasonId = useId();

  if (!expanded) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Remove
        </button>
        {state.error ? (
          <span role="alert" className="text-xs text-red-700">
            {state.error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-56 flex-col items-end gap-2">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="flex w-full flex-col gap-1">
        <label htmlFor={reasonId} className="text-xs font-medium text-neutral-700">
          Reason (optional)
        </label>
        <input
          id={reasonId}
          name="reason"
          type="text"
          autoComplete="off"
          placeholder="e.g. permanently closed"
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          aria-label={`Remove ${candidateName}`}
          className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Removing…' : 'Remove candidate'}
        </button>
      </div>
      {state.error ? (
        <span role="alert" className="text-xs text-red-700">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
