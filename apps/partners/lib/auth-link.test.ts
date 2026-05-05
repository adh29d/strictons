import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConfirmUrl,
  isSafeNextPath,
  maskGenerateLinkResponseForVerification,
  resolvePartnersUrl,
} from './auth-link';

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

describe('maskGenerateLinkResponseForVerification', () => {
  it('masks hashed_token and email_otp while preserving structure', () => {
    const masked = maskGenerateLinkResponseForVerification({
      properties: {
        action_link: 'https://strictons-dev.supabase.co/auth/v1/verify?token=secret&type=magiclink',
        hashed_token: '0123456789abcdef0123456789abcdef',
        email_otp: '123456',
        verification_type: 'magiclink',
        redirect_to: 'https://partners.strictons.com/auth/confirm',
      },
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'alice@example.test',
        role: 'authenticated',
        encrypted_password: 'should-not-appear',
      },
    });

    const m = masked as Record<string, unknown>;
    const props = m.properties as Record<string, unknown>;
    expect(props.hashed_token).toBe('<32 chars masked>');
    expect(props.email_otp).toBe('<masked>');
    expect(props.action_link).toContain('token=<masked>');
    expect(props.action_link).not.toContain('secret');
    expect(props.verification_type).toBe('magiclink');
    expect(props.redirect_to).toBe('https://partners.strictons.com/auth/confirm');

    const user = m.user as Record<string, unknown>;
    expect(user.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(user.email).toBe('alice@example.test');
    expect(user.role).toBe('authenticated');
    expect(user.encrypted_password).toBeUndefined();
  });

  it('returns non-object inputs unchanged', () => {
    expect(maskGenerateLinkResponseForVerification(null)).toBeNull();
    expect(maskGenerateLinkResponseForVerification('foo')).toBe('foo');
    expect(maskGenerateLinkResponseForVerification(42)).toBe(42);
  });

  it('handles missing properties / user gracefully', () => {
    const masked = maskGenerateLinkResponseForVerification({}) as Record<string, unknown>;
    // Function preserves the structural envelope (`properties`, `user`)
    // for the verification log even when the input object is bare —
    // makes it obvious in logs that those slots were absent rather
    // than masked.
    expect(masked.properties).toBeNull();
    expect(masked.user).toBeUndefined();
  });
});
