import { describe, expect, it } from 'vitest';
import type { MembershipSet } from '@strictons/db/auth-types';
import { decideAuth } from './middleware-decision';

const HOTEL_ID = '11111111-1111-4111-8111-111111111111';
const BUSINESS_ID = '22222222-2222-4222-9222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const empty: MembershipSet = {
  userId: USER_ID,
  email: 'alice@example.test',
  roles: [],
  isStrictonsStaff: false,
};

const withHotel: MembershipSet = {
  ...empty,
  roles: [
    {
      kind: 'hotel_admin',
      hotelId: HOTEL_ID,
      hotelSlug: 'alpha',
      hotelName: 'Alpha Hotel',
    },
  ],
};

const withBusiness: MembershipSet = {
  ...empty,
  roles: [
    {
      kind: 'business_user',
      businessId: BUSINESS_ID,
      businessName: 'Sunrise Joyflights',
    },
  ],
};

const staffOnly: MembershipSet = { ...empty, isStrictonsStaff: true };

describe('decideAuth', () => {
  describe('unauthenticated', () => {
    it('redirects to bare /sign-in when path is "/"', () => {
      expect(
        decideAuth({
          hasUser: false,
          memberships: null,
          pathname: '/',
          search: '',
        }),
      ).toEqual({ kind: 'redirect', to: '/sign-in' });
    });

    it('preserves the original path in ?next when pathname is non-root', () => {
      expect(
        decideAuth({
          hasUser: false,
          memberships: null,
          pathname: '/members',
          search: '',
        }),
      ).toEqual({
        kind: 'redirect',
        to: '/sign-in?next=%2Fmembers',
      });
    });

    it('includes the search string in ?next', () => {
      expect(
        decideAuth({
          hasUser: false,
          memberships: null,
          pathname: '/members',
          search: '?hotel=abc',
        }),
      ).toEqual({
        kind: 'redirect',
        to: '/sign-in?next=%2Fmembers%3Fhotel%3Dabc',
      });
    });
  });

  describe('authenticated, no memberships', () => {
    it('redirects to /no-access', () => {
      expect(
        decideAuth({
          hasUser: true,
          memberships: empty,
          pathname: '/',
          search: '',
        }),
      ).toEqual({ kind: 'redirect', to: '/no-access' });
    });
  });

  describe('authenticated, with at least one membership', () => {
    it('lets a hotel_admin through', () => {
      expect(
        decideAuth({
          hasUser: true,
          memberships: withHotel,
          pathname: '/',
          search: '',
        }),
      ).toEqual({ kind: 'next' });
    });

    it('lets a business_user through', () => {
      expect(
        decideAuth({
          hasUser: true,
          memberships: withBusiness,
          pathname: '/members',
          search: '',
        }),
      ).toEqual({ kind: 'next' });
    });
  });

  describe('authenticated strictons_staff (Phase 4 forward-compat)', () => {
    it('lets a staff-only user through even with empty roles', () => {
      // The abstraction is shaped for Phase 4. getMembershipSet currently
      // never sets isStrictonsStaff to true (Phase 3 doesn't query the
      // strictons_staff table), but if it did, the user would not be
      // gated by the no-access redirect.
      expect(
        decideAuth({
          hasUser: true,
          memberships: staffOnly,
          pathname: '/',
          search: '',
        }),
      ).toEqual({ kind: 'next' });
    });
  });

  describe('memberships fetch incomplete', () => {
    it('lets the request through when memberships is null (caller must fetch first)', () => {
      // null guards the brief window where getUser() returned a user but
      // getMembershipSet hasn't run yet. Don't gate on incomplete data.
      expect(
        decideAuth({
          hasUser: true,
          memberships: null,
          pathname: '/',
          search: '',
        }),
      ).toEqual({ kind: 'next' });
    });
  });
});
