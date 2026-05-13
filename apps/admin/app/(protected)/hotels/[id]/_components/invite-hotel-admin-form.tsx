'use client';

import { useActionState, useId } from 'react';
import { inviteHotelAdmin } from '../actions';
import type { InviteHotelAdminState } from '../types';

const INITIAL: InviteHotelAdminState = {};

type Props = {
  hotelId: string;
};

/**
 * Surface 1 — staff invites a hotel admin by email.
 *
 * Uses useActionState against inviteHotelAdmin. Mirrors the partners-
 * side InviteForm convention: uncontrolled email input, no form reset
 * on success — the user's typed value remains in the field for
 * inspection and the success message confirms the invite was sent.
 *
 * Three-layer mutation pattern, layer 3: state.message rendered as
 * role="status" visible text. Commit 6's Playwright spec waits for
 * this text before any reload or downstream assertion. Removing it
 * reintroduces the click-vs-reload race that cost Phase 4 commit 8
 * three diagnostic rounds.
 *
 * Error rendering:
 *   - state.fieldErrors.email under the email input (per-field) —
 *     carries the 23505 unique-violation message from commit 4
 *   - state.error as a top-of-form alert when present and there are
 *     no fieldErrors
 */
export function InviteHotelAdminForm({ hotelId }: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<InviteHotelAdminState, FormData>(
    inviteHotelAdmin,
    INITIAL,
  );

  const emailId = useId();
  const fieldErrorEmail = state.fieldErrors?.email;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="hotelId" value={hotelId} />

      {state.error && !state.fieldErrors ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p
          role="status"
          className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">
          Email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="off"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {fieldErrorEmail ? <p className="text-xs text-red-700">{fieldErrorEmail}</p> : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Sending…' : 'Send invitation'}
      </button>
    </form>
  );
}
