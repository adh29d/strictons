import { createServerClient as ssrCreateServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
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

export type MiddlewareClient = {
  /**
   * RLS-enforced Supabase client bound to the request's cookies. Use
   * `supabase.auth.getUser()` (validated against GoTrue) — never
   * `getSession()`, which trusts the cookie unverified.
   */
  supabase: SupabaseClient<Database>;
  /**
   * Returns the response shaped by any token-refresh writes that
   * happened during the supabase.auth.* calls. Read AFTER auth is done
   * — `setAll` mutates the underlying response in place during a
   * refresh, so reading the closure-bound response is the way to pick
   * up the new cookies and the 0.10.0 cache-control headers.
   */
  getResponse: () => NextResponse;
};

/**
 * Strictons Supabase middleware client.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  MIDDLEWARE-ONLY. Use createServerClient() (./server) for           │
 * │  Server Components / Route Handlers / Server Actions.               │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Middleware operates on NextRequest / NextResponse, not Next.js's
 * `cookies()` API, so it can't reuse `./server`'s factory. This factory
 * wires the @supabase/ssr 0.10 cookie adapter to the request's cookie
 * jar and to a closure-bound NextResponse that token-refresh writes
 * mutate in place. The 0.10.0 cache-headers fix (`Cache-Control:
 * private, no-cache, no-store, ...`) is consumed here — without those
 * headers on the response, Vercel's edge or another upstream CDN can
 * cache an authenticated response and serve one user's session token
 * to a different user.
 *
 * Pattern:
 *
 *     const { supabase, getResponse } = createMiddlewareClient(request);
 *     const { data: { user } } = await supabase.auth.getUser();
 *     // …auth-gated decisions…
 *     return getResponse();   // includes any refresh cookies
 *
 * Like `./server`, this client uses the publishable key (RLS-enforced),
 * never the secret key.
 */
export function createMiddlewareClient(request: NextRequest): MiddlewareClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) {
    throw new Error('createMiddlewareClient: NEXT_PUBLIC_SUPABASE_URL is required');
  }
  if (!key) {
    throw new Error('createMiddlewareClient: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
  }

  let response = NextResponse.next({ request });

  const supabase = ssrCreateServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            response.headers.set(k, v);
          }
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

  return {
    supabase,
    getResponse: () => response,
  };
}
