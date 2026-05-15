'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { approveCandidateList } from '../actions';
import type { ApproveListState } from '../types';

const INITIAL: ApproveListState = {};

type Props = {
  hotelId: string;
  hotelName: string;
};

/**
 * Approve-list confirmation modal + form. Approval is a one-way state
 * transition for the hotel (candidate_list_with_hotel →
 * candidate_list_approved) — staff reopen is the only path back — so
 * the UX carries that weight: the visible "Approve list" button opens
 * a modal explaining the consequence, and the form submission lives
 * inside the modal's "Approve list" confirm button.
 *
 * Post-action flash-message UX (matches the admin commit-8
 * ListStateControls pattern — known small rough edge to be revisited
 * at end of phase): on successful approve, the action's revalidatePath
 * flips hotels.approval_state, the parent server component re-renders,
 * and this component unmounts from the section conditional. The
 * role="status" success text only flashes; the durable post-action
 * signal is the page-header status badge.
 *
 * Accessibility (sensible defaults — not over-engineered):
 *   - role="dialog" + aria-modal="true" on the modal container
 *   - aria-labelledby points at the modal title
 *   - The Confirm button gets focus on open
 *   - ESC closes the modal
 *   - The backdrop click closes the modal (a missed-click bail-out)
 *   - Cancel button restores focus to the trigger
 */
export function ApproveListControls({ hotelId, hotelName }: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<ApproveListState, FormData>(
    approveCandidateList,
    INITIAL,
  );
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded bg-green-700 px-4 py-2 text-white hover:bg-green-800"
      >
        Approve list
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

      {open ? (
        <div
          role="presentation"
          onClick={closeAndRestoreFocus}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-list-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          >
            <h3 id="approve-list-modal-title" className="text-lg font-semibold">
              Approve the candidate list for {hotelName}?
            </h3>
            <p className="mt-3 text-sm text-neutral-700">
              Once you approve the list, you won&apos;t be able to add or remove candidates. Contact
              Strictons to make further changes.
            </p>
            <form action={formAction} className="mt-5 flex justify-end gap-2">
              <input type="hidden" name="hotelId" value={hotelId} />
              <button
                type="button"
                onClick={closeAndRestoreFocus}
                className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={isPending}
                className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
              >
                {isPending ? 'Approving…' : 'Approve list'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
