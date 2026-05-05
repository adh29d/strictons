import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ssrCreateBrowserClientMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => ssrCreateBrowserClientMock(...args),
}));

describe('createBrowserClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    ssrCreateBrowserClientMock.mockReset();
    let n = 0;
    ssrCreateBrowserClientMock.mockImplementation(() => ({ __id: ++n }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const { _resetBrowserClientForTests } = await import('./browser');
    _resetBrowserClientForTests();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { createBrowserClient } = await import('./browser');
    const a = createBrowserClient();
    const b = createBrowserClient();
    const c = createBrowserClient();

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(ssrCreateBrowserClientMock).toHaveBeenCalledTimes(1);
  });

  it('constructs a fresh client after _resetBrowserClientForTests', async () => {
    const { createBrowserClient, _resetBrowserClientForTests } = await import('./browser');
    const a = createBrowserClient();
    _resetBrowserClientForTests();
    const b = createBrowserClient();

    expect(a).not.toBe(b);
    expect(ssrCreateBrowserClientMock).toHaveBeenCalledTimes(2);
  });

  it('passes the publishable key (not the secret key) to ssr', async () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_should_not_appear';
    const { createBrowserClient } = await import('./browser');
    createBrowserClient();

    const [url, key] = ssrCreateBrowserClientMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co');
    expect(key).toBe('sb_publishable_test');
    expect(key).not.toBe('sb_secret_should_not_appear');
  });

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { createBrowserClient } = await import('./browser');
    expect(() => createBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { createBrowserClient } = await import('./browser');
    expect(() => createBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});
