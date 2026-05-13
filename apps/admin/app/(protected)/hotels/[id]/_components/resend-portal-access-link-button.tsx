'use client';

import { useActionState } from 'react';
import { resendPortalAccessLink } from '../actions';
import type { ResendPortalAccessLinkState } from '../types';

const INITIAL: ResendPortalAccessLinkState = {};

type Props = {
  hotelId: string;
  hotelUserId: string;
  /** True when revoked_at IS NOT NULL — the button is rendered disabled. */
  disabled: boolean;
};

/**
 * Surface 2 — staff resends the portal access link to an existing
 * hotel admin.
 *
 * Per-row affordance on the HotelAdminsList. When `disabled` (the
 * hotel_users row has been revoked), the button renders disabled with
 * an aria-label explaining why; the corresponding Server Action's
 * own server-side check rejects revoked rows independently (audit
 * reason 'revoked') so the disabled UI is a UX cue, not the security
 * boundary.
 *
 * Three-layer mutation pattern, layer 3: state.message rendered as
 * role="status" visible text inline next to the button when state.ok.
 * Commit 6's Playwright spec waits for this text before downstream
 * assertions.
 */
export function ResendPortalAccessLinkButton({
  hotelId,
  hotelUserId,
  disabled,
}: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<ResendPortalAccessLinkState, FormData>(
    resendPortalAccessLink,
    INITIAL,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="hotelUserId" value={hotelUserId} />
      <button
        type="submit"
        disabled={disabled || isPending}
        aria-label={disabled ? 'This admin has been revoked' : 'Resend portal access link'}
        title={disabled ? 'This admin has been revoked' : undefined}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Resending…' : 'Resend portal access link'}
      </button>
      {state.ok ? (
        <span role="status" className="text-xs text-green-700">
          {state.message}
        </span>
      ) : null}
      {state.error ? (
        <span role="alert" className="text-xs text-red-700">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
