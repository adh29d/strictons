import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ssrCreateServerClientMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => ssrCreateServerClientMock(...args),
}));

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

describe('createServerClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    ssrCreateServerClientMock.mockReset();
    cookiesMock.mockReset();
    ssrCreateServerClientMock.mockReturnValue({ __mock: 'supabase-client' });
    cookiesMock.mockResolvedValue({
      getAll: vi.fn().mockReturnValue([{ name: 'sb-x', value: 'v' }]),
      set: vi.fn(),
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    delete process.env.SUPABASE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('passes the publishable key (not the secret key) to ssr', async () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_should_not_appear';
    const { createServerClient } = await import('./server');

    await createServerClient();

    expect(ssrCreateServerClientMock).toHaveBeenCalledTimes(1);
    const [url, key] = ssrCreateServerClientMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co');
    expect(key).toBe('sb_publishable_test');
    expect(key).not.toBe('sb_secret_should_not_appear');
  });

  it('wires getAll and setAll cookie methods to next/headers cookies()', async () => {
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: 'sb-x', value: 'v' }]),
      set: vi.fn(),
    };
    cookiesMock.mockResolvedValue(cookieStore);

    const { createServerClient } = await import('./server');
    await createServerClient();

    const opts = ssrCreateServerClientMock.mock.calls[0]![2] as {
      cookies: {
        getAll: () => unknown;
        setAll: (cookiesToSet: { name: string; value: string; options: object }[]) => void;
      };
    };

    opts.cookies.getAll();
    expect(cookieStore.getAll).toHaveBeenCalledTimes(1);

    opts.cookies.setAll([
      { name: 'sb-access-token', value: 'a', options: { path: '/' } },
      { name: 'sb-refresh-token', value: 'r', options: { path: '/' } },
    ]);
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    expect(cookieStore.set).toHaveBeenNthCalledWith(1, 'sb-access-token', 'a', {
      path: '/',
    });
  });

  it('setAll swallows errors from the read-only Server Component cookies() context', async () => {
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn().mockImplementation(() => {
        throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      }),
    };
    cookiesMock.mockResolvedValue(cookieStore);

    const { createServerClient } = await import('./server');
    await createServerClient();

    const opts = ssrCreateServerClientMock.mock.calls[0]![2] as {
      cookies: {
        setAll: (cookiesToSet: { name: string; value: string; options: object }[]) => void;
      };
    };

    expect(() => opts.cookies.setAll([{ name: 'x', value: 'y', options: {} }])).not.toThrow();
  });

  it('passes 7-day maxAge and lax sameSite cookie options', async () => {
    const { createServerClient } = await import('./server');
    await createServerClient();

    const opts = ssrCreateServerClientMock.mock.calls[0]![2] as {
      cookieOptions: {
        httpOnly: boolean;
        sameSite: string;
        path: string;
        maxAge: number;
      };
    };
    expect(opts.cookieOptions.httpOnly).toBe(true);
    expect(opts.cookieOptions.sameSite).toBe('lax');
    expect(opts.cookieOptions.path).toBe('/');
    expect(opts.cookieOptions.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { createServerClient } = await import('./server');
    await expect(createServerClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { createServerClient } = await import('./server');
    await expect(createServerClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});
