import { createBrowserClient as ssrCreateBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

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
 * Strictons browser Supabase client (RLS-enforced, publishable key).
 *
 * Safe to import from `'use client'` modules — only the publishable key
 * is referenced here, which is designed to be exposed to the browser.
 *
 * Returns a singleton: the underlying Supabase client manages a single
 * session; constructing more than one in the same browser tab would race
 * on token refresh and cause the random-logout bugs the SSR docs warn
 * about. The first call constructs; subsequent calls return the cached
 * instance.
 */
let cached: SupabaseClient<Database> | null = null;

export function createBrowserClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) {
    throw new Error('createBrowserClient: NEXT_PUBLIC_SUPABASE_URL is required');
  }
  if (!key) {
    throw new Error('createBrowserClient: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
  }

  // No `cookieOptions` here intentionally — `httpOnly`, `secure`, and
  // `maxAge` are properties the *server* applies when writing auth
  // cookies (in `./server` and the partners-app middleware that lands
  // in commit 9). The browser cannot write `httpOnly` cookies via
  // `document.cookie` regardless, so duplicating the options here would
  // be dead config. The browser client observes whatever the server
  // wrote.
  cached = ssrCreateBrowserClient<Database>(url, key);

  return cached;
}

/**
 * Test-only: clear the singleton cache.
 *
 * Lets vitest exercise the singleton-vs-fresh-construction paths without
 * leaking module state between tests. Not exported through the package's
 * public `./browser` entry — only reachable via deep import in tests.
 */
export function _resetBrowserClientForTests(): void {
  cached = null;
}
