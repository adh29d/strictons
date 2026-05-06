import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConfirmUrl, isSafeNextPath, resolvePartnersUrl } from './auth-link';

describe('resolvePartnersUrl', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_PARTNERS_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses NEXT_PUBLIC_PARTNERS_URL when set', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com';
    expect(resolvePartnersUrl()).toBe('https://partners.strictons.com');
  });

  it('strips a trailing slash from NEXT_PUBLIC_PARTNERS_URL', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com/';
    expect(resolvePartnersUrl()).toBe('https://partners.strictons.com');
  });

  it('falls back to VERCEL_URL with https:// prefix when NEXT_PUBLIC_PARTNERS_URL is unset', () => {
    process.env.VERCEL_URL = 'partners-git-foo.vercel.app';
    expect(resolvePartnersUrl()).toBe('https://partners-git-foo.vercel.app');
  });

  it('prefers NEXT_PUBLIC_PARTNERS_URL when both are set', () => {
    process.env.NEXT_PUBLIC_PARTNERS_URL = 'https://partners.strictons.com';
    process.env.VERCEL_URL = 'partners-git-foo.vercel.app';
    expect(resolvePartnersUrl()).toBe('https://partners.strictons.com');
  });

  it('throws when neither is set', () => {
    expect(() => resolvePartnersUrl()).toThrow(/NEXT_PUBLIC_PARTNERS_URL nor VERCEL_URL/);
  });
});

describe('buildConfirmUrl', () => {
  it('builds a /auth/confirm URL with query params', () => {
    const url = buildConfirmUrl({
      partnersUrl: 'https://partners.strictons.com',
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
      partnersUrl: 'https://partners.strictons.com',
      tokenHash: 'abc123',
      type: 'email',
      next: '/members?invite=true',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('next')).toBe('/members?invite=true');
  });
});

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
