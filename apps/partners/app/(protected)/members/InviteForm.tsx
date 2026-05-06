'use client';

import { useActionState } from 'react';
import { inviteBusinessMember, inviteHotelMember, type ActionState } from './actions';

const INITIAL: ActionState = {};

type Props = {
  scope: 'hotel' | 'business';
  scopeId: string;
};

export function InviteForm({ scope, scopeId }: Props): React.ReactElement {
  const action = scope === 'hotel' ? inviteHotelMember : inviteBusinessMember;
  const scopeIdField = scope === 'hotel' ? 'hotelId' : 'businessId';

  const [state, formAction, isPending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name={scopeIdField} value={scopeId} />
      <label htmlFor="invite-email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="invite-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="rounded border border-neutral-300 px-3 py-2"
      />
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-green-700">
          Invite created. Reload the page to see the new row.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Inviting…' : 'Send invite'}
      </button>
    </form>
  );
}
