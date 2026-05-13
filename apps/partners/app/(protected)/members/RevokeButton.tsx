'use client';

import { useActionState } from 'react';
import { revokeMember } from './actions';
import type { ActionState } from './types';

const INITIAL: ActionState = {};

type Props = {
  membershipId: string;
  scope: 'hotel' | 'business';
  invitedEmail: string;
  scopeName: string;
  disabled: boolean;
};

/**
 * RevokeButton — surfaces revokeMember as a row-level action.
 *
 * useActionState's state.ok is rendered as "Member revoked." in both
 * branches (form-visible AND early-return). Necessary because after
 * a successful revoke, the parent page's row data flips
 * row.revoked_at to non-null, which makes this component's `disabled`
 * prop true and triggers the early-return branch — the form
 * unmounts. Without rendering the success message in BOTH branches:
 *
 *   - revalidatePath propagation timing flips which branch is active
 *     when state.ok=true: stale parent → form branch fires;
 *     fresh parent → early-return branch fires.
 *   - The E2E spec needs a stable post-action signal to gate
 *     admin.reload() on (parallel to InviteForm's "Invite created."
 *     gate). The success message must therefore be visible regardless
 *     of which branch renders.
 *
 * After a hard reload (the spec's admin.reload() or any real user
 * reload), useActionState resets to INITIAL → state.ok=false → the
 * message disappears, leaving the early-return branch's plain
 * <span>—</span>. That's the steady-state UX.
 */
export function RevokeButton({
  membershipId,
  scope,
  invitedEmail,
  scopeName,
  disabled,
}: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState(revokeMember, INITIAL);

  if (disabled) {
    if (state.ok) {
      return (
        <p role="status" className="text-xs text-green-700">
          Member revoked.
        </p>
      );
    }
    return <span className="text-xs text-neutral-400">—</span>;
  }

  // Native confirm() keeps this minimal — Phase 3 placeholder UX. A
  // proper modal lands later if the operation gets fancier.
  function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    const ok = window.confirm(
      `Revoke ${invitedEmail} from ${scopeName}? They will lose access immediately.`,
    );
    if (!ok) e.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={handleConfirm}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="scope" value={scope} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.ok ? (
        <p role="status" className="mt-1 text-xs text-green-700">
          Member revoked.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
