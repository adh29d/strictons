import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';
import type { MembershipSet } from '@strictons/db/auth-types';
import { getMembershipSet } from '@strictons/db/roles';

/**
 * Cached, request-scoped snapshot of the authenticated user and their
 * memberships. React's `cache()` memoises by argument equality within
 * a single render tree — calling `getAuthSnapshot()` from a layout AND
 * a page (or two parallel routes) issues exactly one Supabase round-
 * trip per render.
 *
 * Honest scope:
 *
 *   - This dedupes WITHIN a render tree. It does NOT bridge middleware
 *     and the page render — those run in different runtimes / render
 *     passes, so each independently calls `getMembershipSet`. The
 *     middleware fetch is required for the auth/membership decision
 *     before any rendering happens; it's not removable.
 *
 *   - Server Actions don't share a render tree with pages either; they
 *     should keep using their own auth helpers (apps/partners/app/
 *     (protected)/members/actions.ts already does its own
 *     getMembershipSet via `requireAdmin`).
 *
 * Forward-looking: when a (protected)/layout.tsx lands (Phase 4 nav,
 * etc.), it can call `getAuthSnapshot()` for headerbar context without
 * doubling the page's data fetch.
 */
type AuthSnapshot = {
  user: { id: string; email: string | null };
  memberships: MembershipSet;
};

export const getAuthSnapshot = cache(async (): Promise<AuthSnapshot | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const memberships = await getMembershipSet(supabase, user.id);
  return {
    user: { id: user.id, email: user.email ?? null },
    memberships,
  };
});

/**
 * Convenience: fetch the snapshot or redirect to /sign-in if there is
 * no authenticated user. Page render-time use only — Server Actions and
 * Route Handlers should manage their own auth flow and audit logging.
 */
export async function requireAuthSnapshot(): Promise<AuthSnapshot> {
  const snapshot = await getAuthSnapshot();
  if (!snapshot) redirect('/sign-in');
  return snapshot;
}
