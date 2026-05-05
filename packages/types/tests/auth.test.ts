import { describe, expect, it } from 'vitest';
import { SignInInputSchema } from '../src/auth';

describe('SignInInputSchema', () => {
  it('parses a valid email with no `next`', () => {
    const result = SignInInputSchema.safeParse({ email: 'alice@example.test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.next).toBeUndefined();
    }
  });

  it('rejects an invalid email', () => {
    const result = SignInInputSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing email', () => {
    const result = SignInInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // ---- next: open-redirect protection ----------------------------------

  it('accepts a relative path: "/members"', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '/members',
    });
    expect(result.success).toBe(true);
  });

  it('accepts the bare root path: "/"', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '/',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a deeper path: "/members/invite"', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '/members/invite',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an absolute https URL: "https://evil.com"', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: 'https://evil.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a protocol-relative URL: "//evil.com" (would resolve cross-origin)', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '//evil.com/foo',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    // Empty string fails startsWith("/") and is meaningless as a redirect.
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a path that does not start with "/" (e.g. "members")', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: 'members',
    });
    expect(result.success).toBe(false);
  });

  // Path-traversal sequences like "/../foo" are intentionally allowed at
  // the schema layer — Next.js routing normalises them and an attacker
  // can only reach in-app routes either way (same trust boundary as a
  // normal in-app navigation). Documented here so the absence of a test
  // is a deliberate decision rather than an oversight.
  it('does not block path-traversal sequences (intentional; Next routing normalises)', () => {
    const result = SignInInputSchema.safeParse({
      email: 'alice@example.test',
      next: '/../foo',
    });
    expect(result.success).toBe(true);
  });
});
