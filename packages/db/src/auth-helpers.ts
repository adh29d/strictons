import type { MembershipSet } from './auth-types';

/**
 * Pure auth helpers shared by every Strictons Next.js app.
 *
 * Two functions originated in apps/partners during Phase 3
 * (resolvePartnersUrl, buildConfirmUrl, isSafeNextPath, decideAuth)
 * and were lifted here in Phase 4 commit 3 when the admin app needed
 * structurally identical versions. The decision tree behind each lift
 * is recorded in PROJECT_LOG.md's Phase 4 entry (lift-vs-duplicate).
 *
 * The functions in this module are deliberately pure — no I/O, no
 * Supabase client dependency — so they can live next to types and be
 * unit-tested without faking auth state. The cookie-aware Supabase
 * SSR client and the strictons_staff query stay in @strictons/db's
 * other subpaths (./server, ./middleware, ./browser, ./roles).
 */

// ----------------------------------------------------------------------------
// App identity
// ----------------------------------------------------------------------------

/**
 * Discriminator for the two protected Next.js apps in the monorepo.
 * mystay (guest-facing, unauth) and marketing (public) don't appear
 * here — they don't have an auth surface that needs URL resolution
 * or routing decisions.
 */
export type AppKind = 'partners' | 'admin';

// ----------------------------------------------------------------------------
// URL helpers
// ----------------------------------------------------------------------------

/**
 * Resolve the externally-reachable URL for the given Strictons app.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_PARTNERS_URL / NEXT_PUBLIC_ADMIN_URL — set
 *      explicitly in production env and recommended in preview.
 *   2. VERCEL_URL — set automatically by Vercel on every deployment
 *      (preview and production). Used as a fallback only.
 *
 * VERCEL_URL caveat for cross-app calls
 *
 * VERCEL_URL points at the CURRENT deployment, regardless of which
 * app we're trying to resolve. So `resolveAppUrl('partners')` called
 * from inside the admin app's runtime will fall back to admin's
 * VERCEL_URL — pointing at the wrong app — if NEXT_PUBLIC_PARTNERS_URL
 * isn't set in the admin app's env. For cross-app correctness, the
 * operator MUST set NEXT_PUBLIC_<TARGET>_URL explicitly in the
 * CALLING app's env vars. We cannot detect mis-use at runtime; the
 * symptom would be magic links pointing at the wrong host.
 *
 * In-app calls (resolveAppUrl('partners') from inside partners) are
 * safe with only VERCEL_URL — Phase 3 has relied on this fallback for
 * partners preview deploys.
 *
 * Throws if neither the explicit env var nor VERCEL_URL is set.
 *
 * Env-var read convention: process.env access happens inside this
 * function body, never at module top level, so Next's build-time
 * static analysis can't freeze a stale value into the bundle.
 */
export function resolveAppUrl(appKind: AppKind): string {
  const envVarName = appKind === 'partners' ? 'NEXT_PUBLIC_PARTNERS_URL' : 'NEXT_PUBLIC_ADMIN_URL';
  const explicit = process.env[envVarName];
  if (explicit) return stripTrailingSlash(explicit);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  throw new Error(
    `resolveAppUrl: neither ${envVarName} nor VERCEL_URL is set; cannot construct the ${appKind} app URL`,
  );
}

export type BuildConfirmUrlInput = {
  /**
   * Origin (scheme + host) of the app whose /auth/confirm handler
   * will consume the magic link. Usually the result of
   * resolveAppUrl(appKind). Lifted from Phase 3's partnersUrl param
   * and renamed for app-agnostic clarity.
   */
  appUrl: string;
  tokenHash: string;
  /**
   * Verification type passed to Supabase's verifyOtp. Phase 3's C1
   * verification confirmed 'email' is the value GoTrue accepts when
   * paired with token_hash from admin.generateLink.
   */
  type: string;
  /** Relative in-app path the Route Handler redirects to after sign-in. */
  next: string;
};

/**
 * Build the /auth/confirm URL the magic-link email carries. The
 * Route Handler at that path on the destination app exchanges the
 * token for a session via verifyOtp({ token_hash, type }) and then
 * redirects to `next`.
 */
export function buildConfirmUrl(input: BuildConfirmUrlInput): string {
  const url = new URL('/auth/confirm', input.appUrl);
  url.searchParams.set('token_hash', input.tokenHash);
  url.searchParams.set('type', input.type);
  url.searchParams.set('next', input.next);
  return url.toString();
}

/**
 * Validate that a `next` value from a URL parameter is a safe
 * relative in-app path. Mirrors the SignInInputSchema refine in
 * @strictons/types/auth — Route Handlers consume the value via URL
 * params and don't run the full Zod schema.
 *
 * Blocks open-redirect attacks: rejects protocol-relative URLs
 * (`//evil.com`) and absolute URLs of any scheme.
 */
export function isSafeNextPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('/') && !value.startsWith('//');
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, '');
}

// ----------------------------------------------------------------------------
// Auth routing decision
// ----------------------------------------------------------------------------

/**
 * Outcome of the auth-routing decision. Decoupled from Next's
 * NextResponse so this function is vitest-testable without faking
 * the framework. The middleware translates the result into the
 * appropriate redirect / next() call.
 */
export type AuthDecision = { kind: 'next' } | { kind: 'redirect'; to: string };

export type DecideAuthInput = {
  hasUser: boolean;
  memberships: MembershipSet | null;
  pathname: string;
  search: string;
  /**
   * App-specific predicate determining whether the (authenticated)
   * user has access to this app's protected routes. Phase 4's lift
   * parameterised the partners-side predicate:
   *
   *   partners: (m) => m.roles.length > 0 || m.isStrictonsStaff
   *   admin:    (m) => m.isStrictonsStaff
   *
   * Called only when `hasUser === true` and `memberships !== null`.
   */
  allowWhen: (memberships: MembershipSet) => boolean;
};

/**
 * Decide whether to redirect, and where, given the auth state.
 *
 *   no user                             → /sign-in (with ?next= when
 *                                          path isn't '/')
 *   user, memberships fetched, denied   → /no-access
 *   user, memberships fetched, allowed  → next()
 *   user, memberships not fetched       → next()  (caller should fetch
 *                                                   before calling)
 *
 * `memberships` may be null for the brief window where getUser()
 * succeeds but the membership query has not yet been issued; treat
 * that as "let them through, don't gate on incomplete data." The
 * caller is expected to fetch memberships before calling this.
 */
export function decideAuth(input: DecideAuthInput): AuthDecision {
  if (!input.hasUser) {
    const target = `${input.pathname}${input.search}`;
    if (target === '/' || target === '') {
      return { kind: 'redirect', to: '/sign-in' };
    }
    return {
      kind: 'redirect',
      to: `/sign-in?next=${encodeURIComponent(target)}`,
    };
  }

  if (input.memberships === null) {
    return { kind: 'next' };
  }

  if (!input.allowWhen(input.memberships)) {
    return { kind: 'redirect', to: '/no-access' };
  }

  return { kind: 'next' };
}
