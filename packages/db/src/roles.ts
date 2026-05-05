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
 * This function trusts the supplied client to enforce row-level security.
 * Callers must pass the SSR client (`createServerClient()`) or the
 * browser client (`createBrowserClient()`) — both use the publishable
 * key and run statements as the authenticated user, so the underlying
 * `select` queries return only rows the user is permitted to see.
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
 *     if (memberships.roles.length === 0) redirect('/no-access');
 *
 * Returns ALL memberships, never just the first match — a user can be
 * in multiple hotels and businesses simultaneously, and the partners
 * app surfaces a scope switcher when more than one role is present.
 *
 * Phase 3 note: `isStrictonsStaff` is always `false`. The slot exists
 * for Phase 4 when the abstraction extends to the admin app audience.
 */
export async function getMembershipSet(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MembershipSet> {
  const [userResult, hotelResult, businessResult] = await Promise.all([
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
  ]);

  if (userResult.error) throw userResult.error;
  if (!userResult.data) {
    throw new Error(`getMembershipSet: user ${userId} not found in public.users`);
  }
  if (hotelResult.error) throw hotelResult.error;
  if (businessResult.error) throw businessResult.error;

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
    isStrictonsStaff: false,
  };
}
