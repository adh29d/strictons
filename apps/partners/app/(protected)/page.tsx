import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { PartnerRole } from '@strictons/db/auth-types';
import { requireAuthSnapshot } from '@/lib/auth-cache';

/**
 * Post-sign-in landing for the partners app.
 *
 * Renders header, "Signed in as <email>", a list of roles, and a
 * sign-out button. Admins (hotel_admin or business_admin) also see
 * a "Manage members" link that points at /members?scope=<id> for
 * their first admin scope.
 *
 * Middleware (commit 9) gates this route on (a) verified Supabase
 * auth and (b) at least one membership / strictons_staff. By the
 * time the page renders we know both are true. The `redirect` calls
 * below are belt-and-braces for the race window between the
 * middleware fetch and the page fetch (e.g. an admin revokes the
 * user's only membership in between) — fail closed in that case.
 *
 * Marked dynamic for the same reason as /no-access: the page reads
 * request cookies via createServerClient → next/headers cookies(),
 * and Next would otherwise try to statically prerender at build time
 * and trip the C2 env-var-fail-loud check.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<React.ReactElement> {
  const { memberships } = await requireAuthSnapshot();
  if (memberships.roles.length === 0 && !memberships.isStrictonsStaff) {
    redirect('/no-access');
  }

  const manageMembersHref = pickManageMembersHref(memberships.roles);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Strictons partners</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Signed in as <strong>{memberships.email}</strong>
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold">Roles</h2>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {memberships.roles.map((role, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span>{formatRole(role)}</span>
              {role.kind === 'hotel_admin' ? (
                // Phase 6 commit 10 — per-role candidate-list deeplink for
                // hotel admins. Always visible regardless of the hotel's
                // current approval_state; the destination page handles the
                // empty-state / locked / awaiting-review messaging itself
                // (PHASE_6_PLAN.md §5).
                <Link
                  href={`/hotels/${role.hotelId}/candidates`}
                  className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
                >
                  Candidate list
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-3">
        {manageMembersHref ? (
          <Link
            href={manageMembersHref}
            className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
          >
            Manage members
          </Link>
        ) : null}
        <form action="/sign-out" method="post">
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

function formatRole(role: PartnerRole): string {
  switch (role.kind) {
    case 'hotel_admin':
      return `Hotel admin — ${role.hotelName}`;
    case 'hotel_user':
      return `Hotel user — ${role.hotelName}`;
    case 'business_admin':
      return `Business admin — ${role.businessName}`;
    case 'business_user':
      return `Business user — ${role.businessName}`;
    case 'strictons_staff':
      return 'Strictons staff';
  }
}

/**
 * Pick the first admin scope to point the "Manage members" link at.
 * Returns null when the user has no admin role (the link is hidden in
 * that case). The /members page itself runs an authority check on the
 * scope-id from the URL — this helper only chooses a default URL.
 */
function pickManageMembersHref(roles: PartnerRole[]): string | null {
  for (const role of roles) {
    if (role.kind === 'hotel_admin') {
      return `/members?hotel=${role.hotelId}`;
    }
    if (role.kind === 'business_admin') {
      return `/members?business=${role.businessId}`;
    }
  }
  return null;
}
