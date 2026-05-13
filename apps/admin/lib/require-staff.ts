import { createServerClient } from '@strictons/db/server';
import { getMembershipSet } from '@strictons/db/roles';

/**
 * Admin-app-private auth gate.
 *
 * Lifted from apps/admin/app/(protected)/hotels/actions.ts in Phase 5
 * commit 4 because both that file and the new
 * apps/admin/app/(protected)/hotels/[id]/actions.ts (staff-initiated
 * hotel-admin invite + portal-access-link resend) need to share it,
 * and 'use server' files may only export async functions — so the
 * helper cannot stay in a Server Action module and be shared.
 *
 * Plain server-only module — no 'use server' directive. Callable from
 * Server Actions, Route Handlers, and Server Components alike.
 *
 * Behaviour is byte-equivalent to the pre-lift version:
 *
 *   - createServerClient() reads the request cookies via next/headers
 *   - auth.getUser() returns null when no session is present → 'Not
 *     signed in.' error
 *   - getMembershipSet() returns the four membership sets including
 *     isStrictonsStaff; non-staff are rejected
 *
 * Defence in depth: the (protected) middleware already gates the route
 * group on isStrictonsStaff. This second check costs one Supabase
 * round-trip per action but guarantees no mis-routed Server Action
 * runs against an unauthorised caller.
 *
 * Lift to @strictons/db/auth-helpers only when a second app (e.g.
 * mystay or marketing) needs a staff-only path. Until then it stays
 * admin-private.
 */
export async function requireStaff(): Promise<
  { kind: 'ok'; userId: string; email: string } | { kind: 'error'; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { kind: 'error', error: 'Not signed in.' };
  }
  const memberships = await getMembershipSet(supabase, user.id);
  if (!memberships.isStrictonsStaff) {
    return { kind: 'error', error: 'You do not have Strictons staff access.' };
  }
  return { kind: 'ok', userId: user.id, email: memberships.email };
}
