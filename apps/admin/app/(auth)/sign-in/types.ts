/**
 * State type for the admin-app sign-in Server Action's useActionState
 * hook.
 *
 * Lives outside `actions.ts` because the latter has `'use server'` at
 * the top, which forbids non-async-function exports at runtime. Type
 * exports are TS-erased so they are technically harmless, but Next's
 * 'use server' compiler is strict and the file-co-location rule is
 * easier to follow than its exception.
 *
 * Phase 4 commit 4: structural mirror of the partners-side
 * SignInState. The shape is identical because the form does the same
 * thing in both apps — email input, optional next, error echo on
 * failure. The duplication is justified per §3 of the approved plan
 * (app-specific UI plumbing; abstracting two-line type files would
 * cost more than it saves).
 */
export type SignInState = {
  error?: string;
  emailEcho?: string;
};
