/**
 * Action-state types for the /members admin actions.
 *
 * Lives outside `actions.ts` because the latter has `'use server'` at
 * the top, which forbids non-async-function exports at runtime. Type
 * exports are TS-erased so they are technically harmless, but Next's
 * 'use server' compiler is strict and the file-co-location rule is
 * easier to follow than its exception.
 */
export type ActionState = {
  ok?: true;
  error?: string;
};
