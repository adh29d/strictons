import type { MembershipSet } from '@strictons/db/auth-types';

/**
 * Pure decision function for the partners-app middleware. Decoupled from
 * the Next request/response objects so it's vitest-testable without
 * faking the Supabase client.
 *
 * Three outcomes:
 *   - 'next'                    request is allowed; middleware lets it through
 *   - { kind: 'redirect', to }  middleware redirects to `to`
 */
export type AuthDecision = { kind: 'next' } | { kind: 'redirect'; to: string };

export type DecideAuthInput = {
  hasUser: boolean;
  memberships: MembershipSet | null;
  pathname: string;
  search: string;
};

/**
 * Decide whether to redirect, and where, given the auth state.
 *
 *   no user                             → /sign-in (with ?next= when path
 *                                          isn't '/')
 *   user, no memberships, not staff     → /no-access
 *   user, ≥1 membership OR staff        → next()
 *
 * `memberships` may be null for the brief window where getUser() succeeds
 * but the membership query has not yet been issued; treat that as "let
 * them through, don't gate on incomplete data." The caller is expected
 * to fetch memberships before calling this.
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

  const noAccess = input.memberships.roles.length === 0 && !input.memberships.isStrictonsStaff;
  if (noAccess) {
    return { kind: 'redirect', to: '/no-access' };
  }

  return { kind: 'next' };
}
