import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Strictons service-role Supabase client.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  SERVER-SIDE ONLY. NEVER IMPORT FROM A `'use client'` MODULE.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * The service role bypasses Row Level Security. It exists to power:
 *   - mystay.au guest-guide rendering (Server Components only)
 *   - Strictons admin / partners API routes that need to mutate state
 *     across tenants (audit-logged Server Actions / Route Handlers)
 *   - Background jobs (rollups, magic-link token issuance, seeding)
 *
 * Importing this from a Client Component will inline the
 * SUPABASE_SECRET_KEY value into the browser bundle and hand
 * full database access to anyone who opens DevTools. Don't.
 *
 * Apps should restrict imports to:
 *   - app/**\/page.tsx, layout.tsx, error.tsx (Server Components)
 *   - app/api/**\/route.ts (Route Handlers)
 *   - Server Actions
 *   - background scripts
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url) {
    throw new Error(
      'createServiceRoleClient: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required',
    );
  }
  if (!key) {
    throw new Error('createServiceRoleClient: SUPABASE_SECRET_KEY is required');
  }
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
