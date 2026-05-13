import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { MembershipSet, PartnerRole } from './auth-types';

/**
 * Resolves the partner-role membership set for the given user.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  RLS-DEPENDENT. Pass an RLS-enforced client only.                   │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * This function trusts the supplied client to enforce row-level
 * security. Callers must pass the SSR client (`createServerClient()`)
 * or the browser client (`createBrowserClient()`) — both use the
 * publishable key and run statements as the authenticated user, so
 * the underlying `select` queries return only rows the user is
 * permitted to see.
 *
 * Passing the service-role client (`createServiceRoleClient()`) would
 * defeat that scoping and let the function return memberships for any
 * `userId`, not just the caller's. Don't.
 *
 * Intended call site (middleware / Server Component / Route Handler):
 *
 *     import { createServerClient } from '@strictons/db/server';
 *     import { getMembershipSet } from '@strictons/db/roles';
 *
 *     const supabase = await createServerClient();
 *     const { data: { user } } = await supabase.auth.getUser();
 *     if (!user) redirect('/sign-in');
 *
 *     const memberships = await getMembershipSet(supabase, user.id);
 *     if (memberships.roles.length === 0 && !memberships.isStrictonsStaff)
 *       redirect('/no-access');
 *
 * Returns ALL memberships, never just the first match — a user can
 * be in multiple hotels and businesses simultaneously, and the
 * partners app surfaces a scope switcher when more than one role is
 * present.
 *
 * Round-trip cost
 *
 * Four parallel queries per call: users (for email), hotel_users,
 * business_users, strictons_staff. Issued via Promise.all so wall-
 * clock latency is max(t1..t4), not the sum. Per Phase 4's accepted
 * cost: three membership tables + one profile lookup is the floor
 * for "did the auth get past hello", and we deliberately don't
 * optimise below it (no module-scope cache, no consolidation into
 * a single RPC). Phase 9+'s syd1-region work and any caching are
 * the future levers if measured friction surfaces.
 *
 * Staff query
 *
 * strictons_staff has an RLS SELECT policy of `using
 * (public.is_strictons_staff())`, where the helper is SECURITY
 * DEFINER. For a non-staff user, the policy returns false, the
 * select sees no rows, and `data` is null — so `isStrictonsStaff`
 * is `false`. For a staff user, the policy returns true and their
 * own row is visible; we filter to .eq('user_id', userId).maybeSingle()
 * to confirm presence. No memoisation — the query runs every
 * request, per Phase 3's module-instance-split-in-production
 * gotcha. Request-scoped caching (React.cache) is fine if a future
 * caller needs it within a single request.
 */
export async function getMembershipSet(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MembershipSet> {
  const [userResult, hotelResult, businessResult, staffResult] = await Promise.all([
    supabase.from('users').select('email').eq('id', userId).maybeSingle(),
    supabase
      .from('hotel_users')
      .select('is_admin, hotel_id, hotels(slug, name)')
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null),
    supabase
      .from('business_users')
      .select('is_admin, business_id, businesses(display_name)')
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null),
    supabase.from('strictons_staff').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);

  if (userResult.error) throw userResult.error;
  if (!userResult.data) {
    throw new Error(`getMembershipSet: user ${userId} not found in public.users`);
  }
  if (hotelResult.error) throw hotelResult.error;
  if (businessResult.error) throw businessResult.error;
  if (staffResult.error) throw staffResult.error;

  const roles: PartnerRole[] = [];

  for (const row of hotelResult.data ?? []) {
    if (!row.hotels) continue;
    roles.push({
      kind: row.is_admin ? 'hotel_admin' : 'hotel_user',
      hotelId: row.hotel_id,
      hotelSlug: row.hotels.slug,
      hotelName: row.hotels.name,
    });
  }

  for (const row of businessResult.data ?? []) {
    if (!row.businesses) continue;
    roles.push({
      kind: row.is_admin ? 'business_admin' : 'business_user',
      businessId: row.business_id,
      businessName: row.businesses.display_name,
    });
  }

  return {
    userId,
    email: userResult.data.email,
    roles,
    isStrictonsStaff: staffResult.data !== null,
  };
}
