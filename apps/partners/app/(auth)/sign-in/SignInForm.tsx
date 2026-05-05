'use client';

import { useActionState } from 'react';
import { signInWithEmail, type SignInState } from './actions';

const INITIAL_STATE: SignInState = {};

export function SignInForm({ next }: { next?: string }): React.ReactElement {
  const [state, formAction, isPending] = useActionState(signInWithEmail, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        defaultValue={state.emailEcho ?? ''}
        className="rounded border border-neutral-300 px-3 py-2"
      />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
