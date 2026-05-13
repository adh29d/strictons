import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MembershipSet } from './auth-types';
import {
  buildConfirmUrl,
  decideAuth,
  isSafeNextPath,
  resolveAppUrl,
} from './auth-helpers';

/**
 * Tests for the auth helpers lifted from apps/partners in Phase 4
 * commit 3. The decideAuth tests preserve the partners-side semantics
 * by passing the partners-side allowWhen predicate explicitly:
 *
 *   allowWhen = (m) => m.roles.length > 0 || m.isStrictonsStaff
 *
 * The admin-side predicate ((m) => m.isStrictonsStaff) and the
 * regression case for the now-populated isStrictonsStaff slot land
 * in commit 5, when getMembershipSet starts returning the real value
 * for it. This file is the infrastructure for those tests; the new
 * cases come with the value change.
 */

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

const partnersAllowWhen = (m: MembershipSet): boolean =>
  m.roles.length > 0 || m.isStrictonsStaff;

// ----------------------------------------------------------------------------
// resolveAppUrl
// ----------------------------------------------------------------------------

describe('resolveAppUrl', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_PARTNERS_URL;
    delete process.env.NEXT_PUBLIC_ADMIN_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses NEXT_PUBLIC_PARTNERS_URL for appKind="partners"', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com';
    expect(resolveAppUrl('partners')).toBe('https://partners.strictons.com');
  });

  it('uses NEXT_PUBLIC_ADMIN_URL for appKind="admin"', () => {
    process.env.NEXT_PUBLIC_ADMIN_URL = 'https://admin.strictons.com';
    expect(resolveAppUrl('admin')).toBe('https://admin.strictons.com');
  });

  it('strips a trailing slash from the explicit env var', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com/';
    expect(resolveAppUrl('partners')).toBe('https://partners.strictons.com');
  });

  it('falls back to VERCEL_URL with https:// prefix when the explicit var is unset', () => {
    process.env.VERCEL_URL = 'partners-git-foo.vercel.app';
    expect(resolveAppUrl('partners')).toBe('https://partners-git-foo.vercel.app');
  });

  it('prefers the explicit var over VERCEL_URL when both are set', () => {
    process.env.NEXT_PUBLIC_ADMIN_URL = 'https://admin.strictons.com';
    process.env.VERCEL_URL = 'admin-git-foo.vercel.app';
    expect(resolveAppUrl('admin')).toBe('https://admin.strictons.com');
  });

  it('throws when neither the explicit var nor VERCEL_URL is set', () => {
    expect(() => resolveAppUrl('partners')).toThrow(
      /NEXT_PUBLIC_PARTNERS_URL nor VERCEL_URL/,
    );
    expect(() => resolveAppUrl('admin')).toThrow(
      /NEXT_PUBLIC_ADMIN_URL nor VERCEL_URL/,
    );
  });

  it('partners-side env var does not satisfy admin-side resolution', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com';
    expect(() => resolveAppUrl('admin')).toThrow(/NEXT_PUBLIC_ADMIN_URL/);
  });
});

// ----------------------------------------------------------------------------
// buildConfirmUrl
// ----------------------------------------------------------------------------

describe('buildConfirmUrl', () => {
  it('builds a /auth/confirm URL with query params', () => {
    const url = buildConfirmUrl({
      appUrl: 'https://partners.strictons.com',
      tokenHash: 'abc123',
      type: 'email',
      next: '/members',
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/auth/confirm');
    expect(parsed.searchParams.get('token_hash')).toBe('abc123');
    expect(parsed.searchParams.get('type')).toBe('email');
    expect(parsed.searchParams.get('next')).toBe('/members');
  });

  it('URL-encodes the next path', () => {
    const url = buildConfirmUrl({
      appUrl: 'https://partners.strictons.com',
      tokenHash: 'abc123',
      type: 'email',
      next: '/members?invite=true',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('next')).toBe('/members?invite=true');
  });

  it('builds against an admin-app origin equally', () => {
    const url = buildConfirmUrl({
      appUrl: 'https://admin.strictons.com',
      tokenHash: 'abc123',
      type: 'email',
      next: '/hotels',
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('admin.strictons.com');
    expect(parsed.pathname).toBe('/auth/confirm');
  });
});

// ----------------------------------------------------------------------------
// isSafeNextPath
// ----------------------------------------------------------------------------

describe('isSafeNextPath', () => {
  it.each([
    ['/', true],
    ['/members', true],
    ['/members/invite', true],
    ['', false],
    [null, false],
    [undefined, false],
    ['members', false],
    ['//evil.com', false],
    ['https://evil.com', false],
    ['javascript:alert(1)', false],
  ])('isSafeNextPath(%j) === %s', (input, expected) => {
    expect(isSafeNextPath(input)).toBe(expected);
  });
});

// ----------------------------------------------------------------------------
// decideAuth (with partners-side allowWhen)
// ----------------------------------------------------------------------------

describe('decideAuth', () => {
  describe('unauthenticated', () => {
    it('redirects to bare /sign-in when path is "/"', () => {
      expect(
        decideAuth({
          hasUser: false,
          memberships: null,
          pathname: '/',
          search: '',
          allowWhen: partnersAllowWhen,
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
          allowWhen: partnersAllowWhen,
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
          allowWhen: partnersAllowWhen,
        }),
      ).toEqual({
        kind: 'redirect',
        to: '/sign-in?next=%2Fmembers%3Fhotel%3Dabc',
      });
    });
  });

  describe('authenticated, no memberships (partners predicate)', () => {
    it('redirects to /no-access', () => {
      expect(
        decideAuth({
          hasUser: true,
          memberships: empty,
          pathname: '/',
          search: '',
          allowWhen: partnersAllowWhen,
        }),
      ).toEqual({ kind: 'redirect', to: '/no-access' });
    });
  });

  describe('authenticated, with at least one membership (partners predicate)', () => {
    it('lets a hotel_admin through', () => {
      expect(
        decideAuth({
          hasUser: true,
          memberships: withHotel,
          pathname: '/',
          search: '',
          allowWhen: partnersAllowWhen,
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
          allowWhen: partnersAllowWhen,
        }),
      ).toEqual({ kind: 'next' });
    });
  });

  describe('authenticated strictons_staff (partners predicate)', () => {
    it('lets a staff-only user through even with empty roles', () => {
      // Phase 3 stubbed isStrictonsStaff at false; commit 5 wires the
      // real query. The behavioural guarantee for the partners app
      // doesn't change: staff-only users still pass the partners
      // predicate. The dedicated regression test for the staff slot
      // — "staff + hotel_admin still routes to next() in partners"
      // — lands in commit 5 alongside the slot's first real value.
      expect(
        decideAuth({
          hasUser: true,
          memberships: staffOnly,
          pathname: '/',
          search: '',
          allowWhen: partnersAllowWhen,
        }),
      ).toEqual({ kind: 'next' });
    });
  });

  describe('memberships fetch incomplete', () => {
    it('lets the request through when memberships is null (caller must fetch first)', () => {
      // null guards the brief window where getUser() returned a user
      // but getMembershipSet hasn't run yet. Don't gate on incomplete
      // data.
      expect(
        decideAuth({
          hasUser: true,
          memberships: null,
          pathname: '/',
          search: '',
          allowWhen: partnersAllowWhen,
        }),
      ).toEqual({ kind: 'next' });
    });
  });
});
