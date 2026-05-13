/**
 * Partner role variants for the strictons monorepo.
 *
 * A user can hold multiple PartnerRoles simultaneously (e.g., hotel_admin
 * for one hotel + business_user for one business). The partners app
 * surfaces a scope switcher when more than one role is present.
 *
 * The `strictons_staff` variant is included so Phase 4's admin-app
 * sign-in can reuse the abstraction without a type-shape change.
 * Phase 3's `getMembershipSet` never produces it.
 */
export type PartnerRole =
  | {
      kind: 'hotel_admin' | 'hotel_user';
      hotelId: string;
      hotelSlug: string;
      hotelName: string;
    }
  | {
      kind: 'business_admin' | 'business_user';
      businessId: string;
      businessName: string;
    }
  | { kind: 'strictons_staff' };

/**
 * Aggregated membership view of a single user, returned by
 * `getMembershipSet`. An empty `roles` array represents the no-access
 * state — an authenticated user with no hotel or business membership.
 *
 * `isStrictonsStaff` is wired but always `false` in Phase 3; Phase 4's
 * admin-app commits will populate it from `public.strictons_staff`.
 */
export type MembershipSet = {
  userId: string;
  email: string;
  roles: PartnerRole[];
  isStrictonsStaff: boolean;
};
