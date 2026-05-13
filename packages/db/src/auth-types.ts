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
 * `getMembershipSet`.
 *
 * No-access state depends on the app:
 *   partners app: roles.length === 0 && !isStrictonsStaff
 *   admin    app: !isStrictonsStaff
 * — see decideAuth's allowWhen predicate in @strictons/db/auth-helpers
 * for the canonical encoding.
 *
 * `isStrictonsStaff` is populated from `public.strictons_staff` via
 * the RLS-enforced client from Phase 4 commit 5 onwards. The table's
 * SELECT policy (`using (is_strictons_staff())`, SECURITY DEFINER)
 * gates the row visibility: a non-staff user sees no rows and the
 * flag is `false`; a staff user sees their own row and the flag is
 * `true`. A user can simultaneously be Strictons staff AND a hotel /
 * business member — both arrays / flags coexist, and the partners
 * app surfaces both.
 */
export type MembershipSet = {
  userId: string;
  email: string;
  roles: PartnerRole[];
  isStrictonsStaff: boolean;
};
