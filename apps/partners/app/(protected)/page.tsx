import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';
import { getMembershipSet } from '@strictons/db/roles';
import type { PartnerRole } from '@strictons/db/auth-types';

/**
 * Post-sign-in landing for the partners app.
 *
 * Phase 3 ships this as a placeholder per the plan §3 — header,
 * "Signed in as <email>", a list of roles, and a sign-out button.
 * The "Manage members" link is intentionally absent until commit 11
 * lands /members; surfacing a link that 404s is worse than not
 * surfacing it at all.
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
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in');
  }

  const memberships = await getMembershipSet(supabase, user.id);
  if (memberships.roles.length === 0 && !memberships.isStrictonsStaff) {
    redirect('/no-access');
  }

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
            <li key={i} className="px-4 py-3 text-sm">
              {formatRole(role)}
            </li>
          ))}
        </ul>
      </section>

      <form action="/sign-out" method="post">
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Sign out
        </button>
      </form>
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
