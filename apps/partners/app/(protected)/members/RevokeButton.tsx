'use client';

import { useActionState } from 'react';
import { revokeMember, type ActionState } from './actions';

const INITIAL: ActionState = {};

type Props = {
  membershipId: string;
  scope: 'hotel' | 'business';
  invitedEmail: string;
  scopeName: string;
  disabled: boolean;
};

export function RevokeButton({
  membershipId,
  scope,
  invitedEmail,
  scopeName,
  disabled,
}: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState(revokeMember, INITIAL);

  if (disabled) {
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
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
