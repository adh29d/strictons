import { createServerClient as ssrCreateServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { SESSION_MAX_AGE_SECONDS } from './session';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside the factory function body, never at module
 * top-level. Top-level reads run during Next.js build-time static analysis;
 * when a var is unset (CI, preview environments before configuration,
 * vendored builds) a top-level `process.env.X` evaluation can throw at
 * import time or freeze the resulting value into the build artefact.
 * Reading inside the function defers evaluation to first call, where a
 * missing var fails loudly with an actionable error and the dead-code
 * elimination boundary is unaffected.
 */

/**
 * Strictons SSR cookie-bound Supabase client.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  SERVER-SIDE ONLY. NEVER IMPORT FROM A `'use client'` MODULE.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Unlike `createServiceRoleClient()` in `./client`, this client is
 * RLS-enforced — it uses the publishable key, reads the caller's session
 * from cookies, and lets Postgres apply the same row-level policies a
 * browser client would. Use it for:
 *   - Server Components that render data the user is allowed to see
 *   - Route Handlers and Server Actions that mutate data on the user's
 *     behalf under RLS
 *
 * Token refreshes that complete during a Server Component render cannot
 * write cookies (Server Components can't commit response headers in
 * Next.js 15) — those refreshes are silently dropped here and re-issued
 * by the partners-app middleware on the next request, which has a
 * NextResponse to set cookies and cache headers on. That's the standard
 * Supabase Next.js pattern and is the reason middleware is mandatory for
 * an app that uses this factory.
 *
 * Always create a new client per request — never share a client across
 * requests; cookie state is per-caller.
 */
export async function createServerClient(): Promise<SupabaseClient<Database>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) {
    throw new Error('createServerClient: NEXT_PUBLIC_SUPABASE_URL is required');
  }
  if (!key) {
    throw new Error('createServerClient: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
  }

  const cookieStore = await cookies();

  return ssrCreateServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component context — `cookies()` is read-only here.
          // Middleware applies cookie writes (and the cache-control
          // headers the second `setAll` arg carries) on the next request.
        }
      },
    },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  });
}
